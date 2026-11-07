/** Inline document for the native WebView. All libraries are bundled, with no CDN. */
export function richContentDocument(
  script: string,
  source: string,
  language: "mermaid" | "json-render",
  theme: "light" | "dark",
) {
  const input = JSON.stringify({ source, language, theme }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>html,body{margin:0;padding:0;background:transparent;font:14px system-ui}*{box-sizing:border-box}p{margin:0}svg{max-width:100%;height:auto}button,input{font:inherit;padding:8px;min-height:44px}th,td{text-align:left;padding:8px;border-bottom:1px solid #8886}summary{cursor:pointer;padding:8px 0}</style></head><body><div id="root"></div><script>${script.replace(/<\/script/gi, "<\\/script")}\nT3RichChat.start(${input});</script></body></html>`;
}
