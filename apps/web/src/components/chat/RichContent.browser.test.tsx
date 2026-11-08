import { act, render } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";
import { MermaidDiagram, RichContent } from "@t3tools/chat-renderer/renderer";

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
    await using screen = await render(
      <RichContent language="json-render" source={source} theme="light" />,
    );
    const { container } = screen;
    expect(container.querySelector("input")?.value).toBe("Tony");
    await act(() => container.querySelector("button")?.click());
    expect(container.querySelector("input")?.value).toBe("Claudia");
  });
  it("keeps invalid source inspectable and recovers when corrected", async () => {
    await using screen = await render(
      <RichContent language="json-render" source="{invalid" theme="dark" />,
    );
    const { container } = screen;
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid");
    expect(container.querySelector("pre")?.textContent).toBe("{invalid");
    const source = JSON.stringify({
      root: "text",
      elements: { text: { type: "Text", props: { content: "Recovered" } } },
    });
    await screen.rerender(<RichContent language="json-render" source={source} theme="dark" />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("Recovered");
  });
});

describe("Mermaid diagrams", () => {
  it("renders a real flowchart as SVG and preserves labels", async () => {
    await using screen = await render(
      <MermaidDiagram code="graph TD; Start-->Finish" theme="light" />,
    );
    const { container } = screen;
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
