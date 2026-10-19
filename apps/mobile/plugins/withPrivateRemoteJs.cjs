const {
  withGradleProperties,
  withMainApplication,
  withProjectBuildGradle,
  withXcodeProject,
} = require("expo/config-plugins");

// Retain release signing and an embedded bundle while allowing the private
// client to load Metro. The native launcher remains available if JS fails.
module.exports = function withPrivateRemoteJs(config) {
  config = withXcodeProject(config, (nextConfig) => {
    const phases = Object.values(
      nextConfig.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {},
    );
    const bundlePhase = phases.find(
      (phase) =>
        typeof phase === "object" && phase.name === '"Bundle React Native code and images"',
    );
    if (!bundlePhase) {
      throw new Error("withPrivateRemoteJs: could not find the iOS JavaScript bundle phase.");
    }
    // The native launcher requires Debug on iOS, whose template skips bundling.
    // Keep a physical-device bundle available when Metro is broken or offline.
    const script = JSON.parse(bundlePhase.shellScript);
    bundlePhase.shellScript = JSON.stringify(
      script.replace("export SKIP_BUNDLING=1", "unset SKIP_BUNDLING"),
    );
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
