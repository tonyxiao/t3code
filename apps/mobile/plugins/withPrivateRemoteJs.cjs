const { withGradleProperties, withProjectBuildGradle } = require("expo/config-plugins");

// Retain release signing and an embedded bundle while allowing the private
// client to load Metro. The native launcher remains available if JS fails.
module.exports = function withPrivateRemoteJs(config) {
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
