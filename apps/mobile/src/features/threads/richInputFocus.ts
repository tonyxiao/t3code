import { createContext } from "react";

export interface RichInputTarget {
  measure: (callback: (top: number, bottom: number) => void) => void;
}

// Native and fallback markdown both render inside the feed's focus boundary.
export const RichInputFocusContext = createContext<
  ((target: RichInputTarget, focused: boolean) => void) | null
>(null);

/** Move only enough to keep a card input between the header and floating composer. */
export function richInputScrollAdjustment(
  top: number,
  bottom: number,
  visibleTop: number,
  visibleBottom: number,
) {
  if (top < visibleTop || bottom - top > visibleBottom - visibleTop) return top - visibleTop;
  return Math.max(0, bottom - visibleBottom);
}
