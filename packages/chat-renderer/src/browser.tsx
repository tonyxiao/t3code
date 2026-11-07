import { createRoot } from "react-dom/client";
import { RichContent } from "./renderer.tsx";

/** Mounted only inside the mobile chat's local document. */
export function start(input: {
  source: string;
  language: "mermaid" | "json-render";
  theme: "light" | "dark";
}) {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(<RichContent {...input} />);
  new ResizeObserver(() => {
    const bridge = (
      window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }
    ).ReactNativeWebView;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- React Native WebView accepts one string.
    bridge?.postMessage(JSON.stringify({ height: Math.ceil(root.getBoundingClientRect().height) }));
  }).observe(root);
}
