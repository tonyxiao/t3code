import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { packBundle } from "@tonyxiao/javascript-source-updates/electron";
import { DESKTOP_JAVASCRIPT_RUNTIME_VERSION } from "../../../packages/contracts/src/javascriptSourceRuntime.ts";

const root = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));
const directory = NodePath.resolve(process.argv[2] ?? NodePath.join(root, "apps/web/dist"));
const output = NodePath.resolve(
  process.argv[3] ?? NodePath.join(root, "tmp/javascript-bundle.zip"),
);
if (output.startsWith(directory + NodePath.sep))
  throw new Error("Write the ZIP outside the renderer directory.");
const bytes = await packBundle(directory, {
  runtimeVersion: DESKTOP_JAVASCRIPT_RUNTIME_VERSION,
  version: process.argv[4] ?? "local",
});
await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
await NodeFSP.writeFile(output, bytes);
console.log(output);
