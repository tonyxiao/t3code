const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const extraThemes = require("./generated-uniwind-theme-names.json");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const sourceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const nextMiddleware = sourceMiddleware?.(middleware, server) ?? middleware;
  return (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://metro.invalid");
    if (url.pathname !== "/.well-known/javascript-source.json")
      return nextMiddleware(request, response, next);
    const platform = url.searchParams.get("platform");
    if (platform !== "ios" && platform !== "android") {
      response.writeHead(400);
      response.end("Specify an iOS or Android runtime.");
      return;
    }
    const {
      resolveRuntimeVersionAsync,
    } = require("expo-updates/utils/build/resolveRuntimeVersionAsync");
    void resolveRuntimeVersionAsync(__dirname, platform, {}, {})
      .then(({ runtimeVersion }) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ platform, runtimeVersion }));
      })
      .catch((error) => {
        response.writeHead(503);
        response.end("Could not resolve native runtime compatibility.");
        console.error("[javascript-source] Runtime resolution failed", error);
      });
  };
};

if (process.env.T3CODE_MOBILE_REMOTE_JS === "1") {
  const enhanceMiddleware = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const nextMiddleware = enhanceMiddleware?.(middleware, server) ?? middleware;
    return (request, response, next) => {
      if (request.url?.split("?")[0]?.endsWith(".bundle")) {
        request.headers.accept = "application/javascript";
      }
      return nextMiddleware(request, response, next);
    };
  };
}
const workspaceRoot = path.resolve(__dirname, "../..");
const generatedLicenseModuleRoot = path.join(__dirname, ".generated", "third-party-licenses");
const licenseGeneratorSource = path.join(
  workspaceRoot,
  "scripts",
  "lib",
  "third-party-licenses.ts",
);
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const generatedDeviceStreamRoot = path.join(__dirname, ".generated", "device-stream");
const generatedPreviewStreamRoot = path.join(__dirname, ".generated", "preview-stream");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.t3[/\\\\].*`),
  ],
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    "@t3tools/mobile-third-party-licenses": generatedLicenseModuleRoot,
    "@t3tools/mobile-device-stream": generatedDeviceStreamRoot,
    "@t3tools/mobile-rich-chat": path.join(__dirname, ".generated", "rich-chat"),
    "@t3tools/mobile-preview-stream": generatedPreviewStreamRoot,
  },
};

async function writeFileIfChanged(filePath, contents) {
  try {
    if ((await fs.promises.readFile(filePath, "utf8")) === contents) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.promises.writeFile(filePath, contents, "utf8");
}

async function generateMobileThirdPartyLicenses() {
  await fs.promises.mkdir(generatedLicenseModuleRoot, { recursive: true });
  const generatorVersion = (await fs.promises.stat(licenseGeneratorSource)).mtimeMs;
  const { generateThirdPartyLicenseManifest } = await import(
    `${pathToFileURL(licenseGeneratorSource).href}?version=${String(generatorVersion)}`
  );
  const manifest = await generateThirdPartyLicenseManifest({
    configFile: path.join(workspaceRoot, "third-party-licenses.config.json"),
    packageManifests: [{ bundle: "mobile", path: path.join(__dirname, "package.json") }],
  });

  await Promise.all([
    writeFileIfChanged(
      path.join(generatedLicenseModuleRoot, "index.js"),
      `module.exports = ${JSON.stringify(manifest)};\n`,
    ),
    writeFileIfChanged(
      path.join(generatedLicenseModuleRoot, "package.json"),
      '{"main":"index.js"}\n',
    ),
  ]);
}

async function prepareStreamScripts() {
  const { generateDeviceStreamScript, generatePreviewStreamScript } = await import(
    pathToFileURL(path.join(__dirname, "scripts", "generate-device-stream.mts")).href
  );
  const generateAll = () =>
    Promise.all([generateDeviceStreamScript(), generatePreviewStreamScript()]);
  await generateAll();
  if (process.env.NODE_ENV !== "production") {
    let rebuild = Promise.resolve();
    for (const [directory, files, generate] of [
      [
        "apps/mobile/src/features/devices",
        ["device-stream.browser.ts"],
        generateDeviceStreamScript,
      ],
      [
        "apps/mobile/src/features/browser",
        ["preview-stream.browser.ts"],
        generatePreviewStreamScript,
      ],
      ["packages/client-runtime/src/device", ["stream.ts", "hubAccess.ts"], generateAll],
      [
        "packages/client-runtime/src/preview",
        ["serverBrowserStream.ts"],
        generatePreviewStreamScript,
      ],
    ]) {
      fs.watch(path.join(workspaceRoot, directory), { persistent: false }, (_event, filename) => {
        if (filename && !files.includes(String(filename))) return;
        rebuild = rebuild
          .then(generate)
          .then(() => undefined)
          .catch((error) => {
            console.error("Could not rebuild a WebView stream script:", error);
          });
      });
    }
  }
}

async function prepareRichChat() {
  const { generateRichChatScript } = await import(
    pathToFileURL(path.join(__dirname, "scripts/generate-rich-chat.mts")).href
  );
  await generateRichChatScript();
  if (process.env.NODE_ENV !== "production") {
    let rebuild = Promise.resolve();
    fs.watch(path.join(workspaceRoot, "packages/chat-renderer/src"), { persistent: false }, () => {
      rebuild = rebuild
        .then(generateRichChatScript)
        .catch((error) => console.error("Could not rebuild rich chat:", error));
    });
  }
}

module.exports = Promise.all([
  generateMobileThirdPartyLicenses(),
  prepareStreamScripts(),
  prepareRichChat(),
]).then(() =>
  withUniwindConfig(config, {
    cssEntryFile: "./global.css",
    extraThemes,
    polyfills: { rem: 14 },
  }),
);
