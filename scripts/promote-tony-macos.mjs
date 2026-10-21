import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeChildProcess from "node:child_process";

const require = NodeModule.createRequire(
  new URL("../packages/shared/package.json", import.meta.url),
);
const yaml = require("yaml");
const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg)
  throw new Error(
    "Usage: node scripts/promote-tony-macos.mjs <release-directory> <served-macos-directory>",
  );
const source = NodePath.resolve(sourceArg);
const destination = NodePath.resolve(destinationArg);
const manifest = yaml.parse(NodeFS.readFileSync(NodePath.join(source, "latest-mac.yml"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.files))
  throw new Error("Invalid stable updater manifest.");
const files = manifest.files;
for (const file of files) {
  if (NodePath.basename(file.url) !== file.url || !/\.(zip|dmg)$/.test(file.url))
    throw new Error("Invalid artifact name.");
  const data = NodeFS.readFileSync(NodePath.join(source, file.url));
  if (
    NodeCrypto.createHash("sha512").update(data).digest("base64") !== file.sha512 ||
    data.length !== file.size
  )
    throw new Error(`Checksum mismatch: ${file.url}`);
}
const archive = files.find((file) => file.url.endsWith(".zip"));
if (!archive) throw new Error("A signed ZIP is required for macOS updates.");
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tony-t3-verify-"));
function command(executable, args) {
  const result = NodeChildProcess.spawnSync(executable, args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0)
    throw new Error(`Release verification failed: ${executable}\n${result.stderr}`);
  return result.stdout + result.stderr;
}
try {
  command("/usr/bin/ditto", ["-x", "-k", NodePath.join(source, archive.url), scratch]);
  const apps = NodeFS.readdirSync(scratch).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error("Expected one app in the updater ZIP.");
  const app = NodePath.join(scratch, apps[0]);
  command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  const identity = command("/usr/bin/codesign", ["-dv", "--verbose=4", app]);
  if (
    !identity.includes("TeamIdentifier=H82Z395PDV") ||
    !identity.includes("Identifier=com.tonyxiao.txcode.tony")
  )
    throw new Error("Unexpected signing team or app identity.");
  command("/usr/bin/xcrun", ["stapler", "validate", app]);
  command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
} finally {
  NodeFS.rmSync(scratch, { recursive: true, force: true });
}
const latestPath = NodePath.join(destination, "latest-mac.yml");
if (NodeFS.existsSync(latestPath)) {
  const current = yaml.parse(NodeFS.readFileSync(latestPath, "utf8")).version;
  const before = current.split(".").map(Number),
    after = manifest.version.split(".").map(Number);
  let newer = false;
  for (let i = 0; i < 3; i++) {
    if (after[i] !== before[i]) {
      newer = after[i] > before[i];
      break;
    }
  }
  if (!newer) throw new Error(`Refusing to replace ${current} with ${manifest.version}.`);
}
NodeFS.mkdirSync(NodePath.join(destination, "releases"), { recursive: true });
const releasePath = NodePath.join(destination, "releases", manifest.version);
if (NodeFS.existsSync(releasePath))
  throw new Error("This immutable release directory already exists.");
const staging = NodeFS.mkdtempSync(NodePath.join(destination, "releases", ".staging-"));
for (const name of NodeFS.readdirSync(source)) {
  if (/\.(dmg|zip|blockmap)$/.test(name))
    NodeFS.copyFileSync(NodePath.join(source, name), NodePath.join(staging, name));
}
NodeFS.renameSync(staging, releasePath);
for (const file of files) file.url = `releases/${manifest.version}/${file.url}`;
if (manifest.path)
  manifest.path = `releases/${manifest.version}/${NodePath.basename(manifest.path)}`;
NodeFS.writeFileSync(`${latestPath}.tmp`, yaml.stringify(manifest));
NodeFS.renameSync(`${latestPath}.tmp`, latestPath);
const installers = NodeFS.readdirSync(releasePath).filter((name) => name.endsWith(".dmg"));
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tony txcode for Mac</title><h1>Tony txcode ${manifest.version}</h1><ul>${installers.map((name) => `<li><a href="releases/${manifest.version}/${encodeURIComponent(name)}">${name}</a></li>`).join("")}</ul><p>Install in Applications. Keep Tailscale connected to check for and download updates. Download and restart are currently explicit actions in the app.</p><p><a href="../">All platforms</a></p></html>`;
NodeFS.writeFileSync(NodePath.join(destination, "index.html.tmp"), html);
NodeFS.renameSync(
  NodePath.join(destination, "index.html.tmp"),
  NodePath.join(destination, "index.html"),
);
console.log(`Promoted signed, notarized macOS ${manifest.version}.`);
