const {
  withGradleProperties,
  withMainApplication,
  withPodfile,
  withProjectBuildGradle,
  withXcodeProject,
} = require("expo/config-plugins");

// Retain release signing and an embedded bundle while allowing the private
// client to load Metro. The native launcher remains available if JS fails.
module.exports = function withPrivateRemoteJs(config) {
  config = withPodfile(config, (nextConfig) => {
    // expo-dev-client limits these pod dependencies to Debug. The private
    // Release build also exposes its launcher bridge for source switching.
    const marker = "  use_expo_modules!\n";
    if (!nextConfig.modResults.contents.includes(marker)) {
      throw new Error("withPrivateRemoteJs: could not find the iOS Expo pods anchor.");
    }
    for (const name of ["expo-dev-launcher", "expo-dev-menu"]) {
      const pod = `  pod '${name}', :path => Pathname.new(File.dirname(\`node --print "require.resolve('${name}/package.json', { paths: [require.resolve('expo-dev-client/package.json')] })"\`.strip)).relative_path_from(Pathname.new(__dir__)).to_s, :configurations => ['Release']\n`;
      if (!nextConfig.modResults.contents.includes(`  pod '${name}'`)) {
        nextConfig.modResults.contents = nextConfig.modResults.contents.replace(
          marker,
          marker + pod,
        );
      }
    }
    return nextConfig;
  });
  config = withXcodeProject(config, (nextConfig) => {
    const objects = nextConfig.modResults.hash.project.objects;
    const phases = Object.values(objects.PBXShellScriptBuildPhase ?? {});
    const bundlePhase = phases.find(
      (phase) =>
        typeof phase === "object" && phase.name === '"Bundle React Native code and images"',
    );
    if (!bundlePhase) {
      throw new Error("withPrivateRemoteJs: could not find the iOS JavaScript bundle phase.");
    }
    // The iOS template skips bundling for dev clients. Keep an embedded bundle
    // available when Metro is broken or offline.
    const script = JSON.parse(bundlePhase.shellScript);
    bundlePhase.shellScript = JSON.stringify(
      script.replace("export SKIP_BUNDLING=1", "unset SKIP_BUNDLING"),
    );

    // Expo marks its launcher module as debug-only. Its generated module
    // provider is compiled in the app target, so include that provider's
    // launcher registration in this private Release build as well.
    const targets = Object.values(objects.PBXNativeTarget ?? {}).filter(
      (target) => target?.productType === '"com.apple.product-type.application"',
    );
    if (targets.length !== 1) {
      throw new Error("withPrivateRemoteJs: expected one iOS app target.");
    }
    const configurations = objects.XCConfigurationList?.[targets[0].buildConfigurationList];
    const release = configurations?.buildConfigurations
      ?.map((reference) => objects.XCBuildConfiguration?.[reference.value])
      .find((entry) => entry?.name === "Release");
    if (!release?.buildSettings) {
      throw new Error("withPrivateRemoteJs: could not find Release build settings.");
    }
    const flags =
      release.buildSettings.OTHER_SWIFT_FLAGS ?? '"$(inherited) -D EXPO_CONFIGURATION_RELEASE"';
    if (typeof flags !== "string" || !flags.endsWith('"')) {
      throw new Error("withPrivateRemoteJs: unexpected Release Swift flags.");
    }
    if (!flags.includes("EXPO_CONFIGURATION_DEBUG")) {
      release.buildSettings.OTHER_SWIFT_FLAGS = flags.replace(
        /"$/,
        ' -D EXPO_CONFIGURATION_DEBUG"',
      );
    }
    return nextConfig;
  });
  config = withMainApplication(config, (nextConfig) => {
    const anchor = "context = applicationContext,";
    const contents = nextConfig.modResults.contents;
    if (nextConfig.modResults.language !== "kt" || !contents.includes(anchor)) {
      throw new Error("withPrivateRemoteJs: update the Kotlin ReactHost template anchor.");
    }
    // SDK 58's host factory defaults to ReactBuildConfig.DEBUG, even when the
    // release launcher is enabled. Updates must initialize its dev controller,
    // and Metro needs a real DevSupportManager rather than the release stub.
    if (!contents.includes("useDevSupport = true,")) {
      nextConfig.modResults.contents = contents.replace(
        anchor,
        `${anchor}\n      useDevSupport = true,`,
      );
    }
    return nextConfig;
  });
  config = withProjectBuildGradle(config, (nextConfig) => {
    const block =
      '\n// Expo\'s release opt-in includes launcher code/resources, but its activity\n// declarations live in the debug manifest. Include those declarations too.\nsubprojects { subproject ->\n    if (subproject.name == "expo-dev-launcher") {\n        subproject.plugins.withId("com.android.library") {\n            subproject.android.sourceSets.release.manifest.srcFile(\n                subproject.file("src/debug/AndroidManifest.xml")\n            )\n        }\n    }\n}\n';
    if (!nextConfig.modResults.contents.includes('subproject.name == "expo-dev-launcher"')) {
      nextConfig.modResults.contents += block;
    }
    return nextConfig;
  });
  return withGradleProperties(config, (nextConfig) => {
    const values = {
      "expo.devlauncher.configureInRelease": "true",
      "expo.devmenu.configureInRelease": "true",
      // The launcher injects bundle loaders through reflection, including
      // ExpoReactHostDelegate._jsBundleLoader. R8 renames those private fields.
      "android.enableMinifyInReleaseBuilds": "false",
      reactNativeArchitectures: "arm64-v8a",
    };
    nextConfig.modResults = nextConfig.modResults.filter(
      (item) => !(item.type === "property" && Object.hasOwn(values, item.key)),
    );
    for (const [key, value] of Object.entries(values)) {
      nextConfig.modResults.push({ type: "property", key, value });
    }
    return nextConfig;
  });
};
