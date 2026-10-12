import type { ScopedThreadRef } from "@t3tools/contracts";

const EVENT = "t3:rename-thread";

export function requestThreadRename(threadRef: ScopedThreadRef): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: threadRef }));
}

export function onRequestThreadRename(listener: (threadRef: ScopedThreadRef) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ScopedThreadRef>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
