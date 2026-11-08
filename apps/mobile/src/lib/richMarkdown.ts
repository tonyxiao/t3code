import type { RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { richContentLanguage } from "@t3tools/chat-renderer/language";

const parser = unified().use(remarkParse);

/** Use native standalone-link slots for rich fences, retaining native Markdown around them. */
export function markdownWithRichContent(markdown: string, isStreaming = false) {
  const blocks = new Map<string, { content: string; language: "mermaid" | "json-render" }>();
  if (!/^[ \t>]*(`{3,}|~{3,})(?:mermaid|json-render)\b/im.test(markdown))
    return { markdown, blocks };
  const edits: Array<{ start: number; end: number; url: string }> = [];
  const visit = (node: RootContent) => {
    // Native standalone-link slots support document and quote containers, but not list items.
    if (node.type === "blockquote") {
      node.children.forEach(visit);
      return;
    }
    if (node.type !== "code") return;
    const language = richContentLanguage(node.lang);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (!language || start === undefined || end === undefined) return;
    const source = markdown.slice(start, end);
    const opening = /^(`{3,}|~{3,})/.exec(source)?.[1];
    if (!opening) return;
    const closing = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t]*$/.exec(
      source.split("\n").at(-1) ?? "",
    )?.[1];
    if (isStreaming && (!closing || closing[0] !== opening[0] || closing.length < opening.length))
      return;
    const url = `t3-rich-content://block/${start}`;
    blocks.set(url, { content: node.value, language });
    edits.push({ start, end, url });
  };
  parser.parse(markdown).children.forEach(visit);
  for (const edit of [...edits].reverse()) {
    markdown = `${markdown.slice(0, edit.start)}[Rich content](${edit.url})${markdown.slice(edit.end)}`;
  }
  return { markdown, blocks };
}
