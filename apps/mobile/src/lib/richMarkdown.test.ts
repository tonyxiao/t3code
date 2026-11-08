import { describe, expect, it } from "vite-plus/test";
import { markdownWithRichContent } from "./richMarkdown";

describe("native rich Markdown slots", () => {
  it("keeps surrounding text and ordinary code while replacing rich fences in order", () => {
    const source =
      'Before\n\n```json-render\n{"root":"card"}\n```\n\n```ts\nconst x = 1;\n```\n\n~~~mermaid\ngraph TD; A-->B\n~~~\n\nAfter';
    const result = markdownWithRichContent(source);
    expect([...result.blocks.values()]).toEqual([
      { content: '{"root":"card"}', language: "json-render" },
      { content: "graph TD; A-->B", language: "mermaid" },
    ]);
    expect(result.markdown).toContain("```ts\nconst x = 1;\n```");
    expect(result.markdown).toMatch(/^Before/);
    expect(result.markdown).toMatch(/After$/);
    expect(result.markdown.match(/\[Rich content\]/g)).toHaveLength(2);
  });
  it("retains incomplete fences during streaming and renders once closed", () => {
    const source = '```json-render\n{"root":"card"}';
    expect(markdownWithRichContent(source, true).markdown).toBe(source);
    expect(markdownWithRichContent(source + "\n```", true).blocks.size).toBe(1);
  });
  it("supports quoted fences and leaves list fences as native code", () => {
    const result = markdownWithRichContent(
      "> ```mermaid\n> graph TD; A-->B\n> ```\n\n- ```mermaid\n  graph TD; C-->D\n  ```",
    );
    expect(result.blocks.size).toBe(1);
    expect(result.markdown).toContain("> [Rich content]");
    expect(result.markdown).toContain("- ```mermaid");
  });
  it("does not interpret a rich-looking fence inside another code block", () => {
    const source = "````md\n```json-render\n{}\n```\n````";
    expect(markdownWithRichContent(source).markdown).toBe(source);
  });
});
