// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MermaidDiagram, RichContent } from "./renderer.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

describe("interactive chat cards", () => {
  it("updates a bound input when the reader presses a state action", async () => {
    const source = JSON.stringify({
      root: "card",
      state: { form: { name: "Tony" } },
      elements: {
        card: { type: "Card", props: { title: "Example" }, children: ["input", "button"] },
        input: { type: "Input", props: { label: "Name", statePath: "/form/name" } },
        button: {
          type: "Button",
          props: { label: "Reset" },
          on: {
            press: { action: "setState", params: { statePath: "/form/name", value: "Claudia" } },
          },
        },
      },
    });
    await act(() =>
      root.render(<RichContent language="json-render" source={source} theme="light" />),
    );
    expect(container.querySelector("input")?.value).toBe("Tony");
    await act(() => container.querySelector("button")?.click());
    expect(container.querySelector("input")?.value).toBe("Claudia");
  });
  it("keeps invalid source inspectable and recovers when corrected", async () => {
    await act(() =>
      root.render(<RichContent language="json-render" source="{invalid" theme="dark" />),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid");
    expect(container.querySelector("pre")?.textContent).toBe("{invalid");
    const source = JSON.stringify({
      root: "text",
      elements: { text: { type: "Text", props: { content: "Recovered" } } },
    });
    await act(() =>
      root.render(<RichContent language="json-render" source={source} theme="dark" />),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("Recovered");
  });
});

describe("Mermaid diagrams", () => {
  it("renders a real flowchart as SVG and preserves labels", async () => {
    Object.defineProperty(SVGElement.prototype, "getBBox", {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    });
    Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
      configurable: true,
      value: () => 80,
    });
    await act(() => root.render(<MermaidDiagram code="graph TD; Start-->Finish" theme="light" />));
    await vi.waitFor(
      async () => {
        await act(async () => {
          await Promise.resolve();
        });
        const image = container.querySelector("img");
        expect(image, container.textContent ?? "").not.toBeNull();
        const svg = decodeURIComponent(
          image?.getAttribute("src")?.split(",").slice(1).join(",") ?? "",
        );
        expect(svg).toContain("<svg");
        expect(svg).toContain("Start");
        expect(svg).toContain("Finish");
        expect(svg).toContain("animation:none!important");
      },
      { timeout: 5000 },
    );
  });
});
