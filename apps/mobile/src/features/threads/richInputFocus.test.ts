import { describe, expect, it } from "vite-plus/test";
import { richInputScrollAdjustment } from "./richInputFocus";

describe("rich input visibility", () => {
  it("leaves an input inside the available keyboard viewport in place", () => {
    expect(richInputScrollAdjustment(160, 204, 100, 320)).toBe(0);
  });
  it("clears the floating composer when the keyboard opens on a tablet", () => {
    expect(richInputScrollAdjustment(330, 374, 100, 320)).toBe(54);
  });
  it("brings an input scrolled behind the header back into view", () => {
    expect(richInputScrollAdjustment(50, 94, 100, 320)).toBe(-50);
  });
  it("keeps the top visible when the input exceeds the available space", () => {
    expect(richInputScrollAdjustment(140, 400, 100, 320)).toBe(40);
  });
});
