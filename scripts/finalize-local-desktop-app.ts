// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Standalone signing script uses Node and osx-sign directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { sign } from "@electron/osx-sign";

const app = NodePath.resolve(process.argv[2] ?? "");
if (!app.endsWith(".app")) {
  throw new Error("Expected the path to a built .app bundle.");
}

// Effect's staging copy rewrites relative symlinks to absolute staging paths.
// Restore bundle-relative links before the temporary stage disappears.
async function repairBundleLinks(directory: string): Promise<void> {
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
    const file = NodePath.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await NodeFSP.readlink(file);
      const marker = `${NodePath.sep}${NodePath.basename(app)}${NodePath.sep}`;
      const markerIndex = target.indexOf(marker);
      if (
        target.startsWith(NodePath.join(NodeOS.tmpdir(), "t3code-desktop-mac-stage-")) &&
        markerIndex !== -1
      ) {
        const internalTarget = NodePath.resolve(app, target.slice(markerIndex + marker.length));
        if (!internalTarget.startsWith(`${app}${NodePath.sep}`)) {
          throw new Error(`Symlink escapes the app bundle: ${file}`);
        }
        await NodeFSP.unlink(file);
        await NodeFSP.symlink(NodePath.relative(NodePath.dirname(file), internalTarget), file);
      }
    } else if (entry.isDirectory()) {
      await repairBundleLinks(file);
    }
  }
}

const identities = NodeChildProcess.execFileSync(
  "security",
  ["find-identity", "-v", "-p", "codesigning"],
  {
    encoding: "utf8",
  },
);
const available = [...identities.matchAll(/\b([A-F0-9]{40}) "([^"]+)"/g)];
// Pin this environment variable to a certificate SHA-1 to keep using it when
// multiple signing identities are installed.
const identity =
  process.env.T3CODE_CODESIGN_IDENTITY ??
  available.find((match) => match[2]?.startsWith("Developer ID Application:"))?.[1] ??
  available.find((match) => match[2]?.startsWith("Apple Development:"))?.[1];
if (!identity) {
  throw new Error(
    "No signing identity found. Create a certificate in Xcode → Settings → Accounts.",
  );
}

await repairBundleLinks(app);
console.log(`Signing ${app} with ${identity}`);
await sign({
  app,
  identity,
  platform: "darwin",
  type: "development",
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  batchCodesignCalls: true,
});
NodeChildProcess.execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
  stdio: "inherit",
});
console.log(`Signed and verified: ${app}`);
