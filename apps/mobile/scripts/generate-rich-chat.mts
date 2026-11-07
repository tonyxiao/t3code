import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { build } from "vite-plus";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

/** Bundle the same inline renderer as web so diagrams also work offline on mobile. */
export async function buildRichChatScript() {
  const result = await build({
    configFile: false,
    // Metro runs in development, but this embedded document bundles production React.
    oxc: { jsx: { development: false } },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodePath.join(mobileRoot, "../../packages/chat-renderer/src/browser.tsx"),
        name: "T3RichChat",
        formats: ["iife"],
      },
    },
  });
  const chunk = (Array.isArray(result) ? result : [result])
    .flatMap((bundle) => ("output" in bundle ? bundle.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Rich chat build did not emit a script.");
  return chunk.code;
}

export async function generateRichChatScript() {
  const script = await buildRichChatScript();
  const root = NodePath.join(mobileRoot, ".generated/rich-chat");
  await NodeFSP.mkdir(root, { recursive: true });
  for (const [name, contents] of [
    ["index.js", `module.exports = ${JSON.stringify(script)};\n`],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(root, name);
    if ((await NodeFSP.readFile(destination, "utf8").catch(() => null)) !== contents)
      await NodeFSP.writeFile(destination, contents);
  }
}
