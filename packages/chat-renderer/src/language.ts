/** Kept separate so ordinary markdown never loads the renderer or its catalog. */
export function richContentLanguage(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase();
  return normalized === "mermaid" || normalized === "json-render" ? normalized : null;
}
