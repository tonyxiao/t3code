// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { buildRichChatScript } from "./generate-rich-chat.mts";

// Metro loads its config in development. The embedded renderer must still run
// against the production React runtime bundled into its standalone document.
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("renders working local controls in the bundle generated under Metro's development environment", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const script = await buildRichChatScript();
  const root = document.createElement("div");
  root.id = "root";
  document.body.append(root);
  const source = JSON.stringify({
    root: "card",
    state: { name: "Tony" },
    elements: {
      card: { type: "Card", props: { title: "Native card" }, children: ["input", "button"] },
      input: { type: "Input", props: { label: "Name", statePath: "/name" } },
      button: {
        type: "Button",
        props: { label: "Reset" },
        on: { press: { action: "setState", params: { statePath: "/name", value: "Claudia" } } },
      },
    },
  });
  window.eval(
    script +
      `\nT3RichChat.start(${JSON.stringify({ source, language: "json-render", theme: "light" })});`,
  );
  await vi.waitFor(() => expect(root.querySelector("input")?.value).toBe("Tony"));
  root.querySelector("button")?.click();
  await vi.waitFor(() => expect(root.querySelector("input")?.value).toBe("Claudia"));
});
