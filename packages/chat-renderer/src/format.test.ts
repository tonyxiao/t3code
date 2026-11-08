import { describe, expect, it } from "vite-plus/test";
import { parseChatSpec } from "./format.ts";
import { richContentLanguage } from "./language.ts";
import { richContentDocument } from "./document.ts";

const card = () => ({
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: { title: "Deploys" },
      children: ["table", "diagram", "input", "button"],
    },
    table: { type: "Table", props: { headers: ["Name", "Count"], rows: [["web", 12]] } },
    diagram: { type: "Mermaid", props: { code: "graph TD; A-->B" } },
    input: { type: "Input", props: { label: "Name", statePath: "/form/name" } },
    button: {
      type: "Button",
      props: { label: "Reset" },
      on: { press: { action: "setState", params: { statePath: "/form/name", value: "" } } },
    },
  },
  state: { form: { name: "Tony" } },
});

describe("chat specs", () => {
  it("accepts a card containing a table, Mermaid and local controls", () => {
    const spec = parseChatSpec(JSON.stringify(card()));
    expect(spec.elements.diagram?.props.code).toBe("graph TD; A-->B");
    expect(spec.state).toEqual({ form: { name: "Tony" } });
  });
  it("accepts a financial overview whose Fields container omits empty props", () => {
    const spec = parseChatSpec(
      JSON.stringify({
        root: "card",
        elements: {
          card: {
            type: "Card",
            props: { title: "Financial overview" },
            children: ["metrics"],
          },
          metrics: { type: "Fields", children: ["revenue"] },
          revenue: { type: "Field", props: { label: "Revenue", value: "$12.4M" } },
        },
      }),
    );
    expect(spec.elements.metrics?.props).toEqual({});
    expect(spec.elements.revenue?.props.value).toBe("$12.4M");
  });
  it("still rejects missing required props and explicitly invalid props", () => {
    for (const element of [
      { type: "Text" },
      { type: "Field", props: { label: "Revenue" } },
      { type: "Fields", props: null },
      { type: "Fields", props: { unsupported: true } },
    ]) {
      expect(() =>
        parseChatSpec(JSON.stringify({ root: "element", elements: { element } })),
      ).toThrow();
    }
  });
  it("rejects missing references and cycles", () => {
    const spec = card();
    spec.elements.card.children = ["missing"];
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow("Missing component");
    spec.elements.card.children = ["constructor"];
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow("Missing component");
    spec.elements.card.children = ["card"];
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow("cycle");
  });
  it("bounds repeated expansion of a shared graph", () => {
    const elements: Record<string, object> = {};
    for (let index = 0; index < 12; index++)
      elements[String(index)] = {
        type: "Section",
        props: {},
        children: index < 11 ? [String(index + 1), String(index + 1)] : [],
      };
    expect(() => parseChatSpec(JSON.stringify({ root: "0", elements }))).toThrow(
      "too deeply nested",
    );
  });
  it("rejects executable actions and dangerous state paths", () => {
    const spec = card();
    const action = spec.elements.button.on.press;
    action.action = "runShell";
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow();
    action.action = "setState";
    action.params.statePath = "/__proto__/polluted";
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow();
    expect({}).not.toHaveProperty("polluted");
  });
  it("rejects mismatched table columns and chart series", () => {
    const spec = card();
    spec.elements.table.props.rows = [["web"]];
    expect(() => parseChatSpec(JSON.stringify(spec))).toThrow("mismatched columns");
    expect(() =>
      parseChatSpec(
        JSON.stringify({
          root: "chart",
          elements: {
            chart: {
              type: "Chart",
              props: {
                title: "Deploys",
                chart: {
                  type: "line",
                  categories: ["Monday"],
                  series: [{ name: "Web", values: [1, 2] }],
                },
              },
            },
          },
        }),
      ),
    ).toThrow("mismatched series");
  });
  it("rejects unsupported components, excessive elements, and oversized source", () => {
    expect(() =>
      parseChatSpec('{"root":"a","elements":{"a":{"type":"Script","props":{}}}}'),
    ).toThrow("Unsupported component");
    const elements = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [index, { type: "Section", props: {} }]),
    );
    expect(() => parseChatSpec(JSON.stringify({ root: "0", elements }))).toThrow("200 elements");
    expect(() => parseChatSpec(" ".repeat(250001))).toThrow("too large");
  });
});

describe("rich content transport", () => {
  it("recognizes only explicit rich fences", () => {
    expect(richContentLanguage(" MERMAID ")).toBe("mermaid");
    expect(richContentLanguage("json-render")).toBe("json-render");
    expect(richContentLanguage("json")).toBeNull();
    expect(richContentLanguage(undefined)).toBeNull();
  });
  it("keeps source data from escaping the native document's script", () => {
    const source = '</script><script>alert("x")</script>';
    const html = richContentDocument("window.library = true;", source, "mermaid", "dark");
    expect(html).not.toContain(source);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("default-src 'none'");
    const body = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(body).toBeDefined();
    let delivered: unknown;
    // Check the actual document executes and delivers the original data intact.
    new Function("T3RichChat", "window", body ?? "")(
      {
        start: (value: unknown) => {
          delivered = value;
        },
      },
      {},
    );
    expect(delivered).toEqual({ source, language: "mermaid", theme: "dark" });
  });
});
