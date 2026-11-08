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
  const post = (message: unknown) => {
    const bridge = (
      window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }
    ).ReactNativeWebView;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- React Native WebView accepts one string.
    bridge?.postMessage(JSON.stringify(message));
  };
  const reportFocus = () => {
    const input = document.activeElement;
    if (input instanceof HTMLInputElement && root.contains(input)) {
      const rect = input.getBoundingClientRect();
      post({ inputFocus: { top: rect.top, bottom: rect.bottom } });
    } else {
      post({ inputFocus: null });
    }
  };
  root.addEventListener("focusin", reportFocus);
  // Tapping the same DOM input after a native composer used the keyboard need not emit focusin.
  root.addEventListener("pointerup", () => requestAnimationFrame(reportFocus));
  root.addEventListener("focusout", () => queueMicrotask(reportFocus));
  window.visualViewport?.addEventListener("resize", reportFocus);
  createRoot(root).render(<RichContent {...input} />);
  new ResizeObserver(() => {
    post({ height: Math.ceil(root.getBoundingClientRect().height) });
  }).observe(root);
}
