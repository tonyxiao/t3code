import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

it("fingerprinting loads imported TypeScript native configuration through Node's module capture hook", async () => {
  const root = NodeURL.fileURLToPath(new URL("./", import.meta.url));
  const require = NodeModule.createRequire(new URL("./package.json", import.meta.url));
  const expoRequire = NodeModule.createRequire(require.resolve("expo/fingerprint"));
  const loader = expoRequire.resolve("@expo/fingerprint/build/ExpoConfigLoader");
  const temporaryRoot = NodePath.join(root, "../../tmp");
  await NodeFSP.mkdir(temporaryRoot, { recursive: true });
  const fixture = await NodeFSP.mkdtemp(NodePath.join(temporaryRoot, "fingerprint-"));
  try {
    await NodeFSP.symlink(
      NodePath.join(root, "node_modules"),
      NodePath.join(fixture, "node_modules"),
      "dir",
    );
    await NodeFSP.writeFile(
      NodePath.join(fixture, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await NodeFSP.writeFile(
      NodePath.join(fixture, "native-config.ts"),
      'export const native = { name: "Native fingerprint fixture" } as const;',
    );
    await NodeFSP.writeFile(
      NodePath.join(fixture, "app.config.ts"),
      'import { native } from "./native-config.ts"; export default { name: native.name, slug: "fingerprint-fixture" };',
    );
    const result = await new Promise<{ code: number | null; payload: unknown; stderr: string }>(
      (resolve, reject) => {
        const child = NodeChildProcess.fork(loader, [fixture, "--mode", "development"], {
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          execArgv: [],
        });
        let payload: unknown;
        let stderr = "";
        child.on("message", (value) => {
          payload = value;
        });
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, payload, stderr }));
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(String(result.payload)).config.exp.name).toBe("Native fingerprint fixture");
  } finally {
    await NodeFSP.rm(fixture, { recursive: true, force: true });
  }
});
