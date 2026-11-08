import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

const version = process.argv[2];
const arch = process.argv[3] ?? "arm64";
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !["arm64", "x64"].includes(arch)) {
  throw new Error("Usage: node scripts/build-tony-macos.mjs <version> [arm64|x64]");
}
if (Effect.runSync(HostProcess.Platform) !== "darwin") throw new Error("Build on macOS.");
for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
]) {
  if (!process.env[key]) throw new Error(`Missing signing credential: ${key}`);
}
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tony-t3-notary-"));
const env = {
  ...process.env,
  PATH: `${process.cwd()}/node_modules/.bin:${process.env.PATH}`,
  T3CODE_DESKTOP_TONY_BUILD: "1",
  T3CODE_DESKTOP_UPDATE_URL: "https://cs-mini.meteor-ruffe.ts.net/txcode-v2-downloads/macos/",
};
delete env.ELECTRON_RUN_AS_NODE;
const keychain = NodePath.join(scratch, "signing.keychain-db");
function security(args) {
  const result = NodeChildProcess.spawnSync("/usr/bin/security", args, { stdio: "pipe" });
  if (result.status !== 0) throw new Error(`Signing keychain operation failed: ${args[0]}`);
}
try {
  // electron-builder 26.15.6 passes the P12 password to set-key-partition-list
  // instead of its generated keychain password. Import into our own keychain.
  const keychainPassword = NodeCrypto.randomBytes(32).toString("hex");
  const certificatePath = NodePath.join(scratch, "signing.p12");
  NodeFS.writeFileSync(
    certificatePath,
    NodeFS.existsSync(env.CSC_LINK)
      ? NodeFS.readFileSync(env.CSC_LINK)
      : Buffer.from(env.CSC_LINK, "base64"),
    { mode: 0o600 },
  );
  security(["create-keychain", "-p", keychainPassword, keychain]);
  security(["unlock-keychain", "-p", keychainPassword, keychain]);
  security(["set-keychain-settings", "-lut", "21600", keychain]);
  security([
    "import",
    certificatePath,
    "-k",
    keychain,
    "-P",
    env.CSC_KEY_PASSWORD,
    "-T",
    "/usr/bin/codesign",
  ]);
  security([
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:",
    "-s",
    "-k",
    keychainPassword,
    keychain,
  ]);
  env.CSC_KEYCHAIN = keychain;
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  if (env.APPLE_API_KEY.includes("BEGIN PRIVATE KEY")) {
    const keyPath = NodePath.join(scratch, "notary.p8");
    NodeFS.writeFileSync(keyPath, env.APPLE_API_KEY, { mode: 0o600 });
    env.APPLE_API_KEY = keyPath;
  }
  function run(args) {
    const result = NodeChildProcess.spawnSync(process.execPath, args, { env, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Build step failed: ${args[0]}`);
  }
  run(["node_modules/vite-plus/bin/vp", "run", "build:desktop"]);
  run([
    "scripts/build-desktop-artifact.ts",
    "--platform",
    "mac",
    "--target",
    "dmg",
    "--arch",
    arch,
    "--build-version",
    version,
    "--skip-build",
    "--signed",
    "--verbose",
  ]);
} finally {
  NodeChildProcess.spawnSync("/usr/bin/security", ["delete-keychain", keychain], { stdio: "pipe" });
  NodeFS.rmSync(scratch, { recursive: true, force: true });
}
