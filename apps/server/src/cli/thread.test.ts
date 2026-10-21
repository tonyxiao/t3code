import { describe, expect, it } from "vite-plus/test";
import { wakeAt } from "./thread.ts";

const now = Date.parse("2026-10-19T00:00:00.000Z");

describe("thread CLI snooze time", () => {
  it("accepts relative and absolute future times", () => {
    expect(wakeAt("2h", undefined, now)).toBe("2026-10-19T02:00:00.000Z");
    expect(wakeAt("3d", undefined, now)).toBe("2026-10-22T00:00:00.000Z");
    expect(wakeAt(undefined, "2026-10-20T09:30:00Z", now)).toBe("2026-10-20T09:30:00.000Z");
  });

  it("rejects missing, ambiguous, malformed, and past wake times", () => {
    expect(() => wakeAt(undefined, undefined, now)).toThrow(/exactly one/);
    expect(() => wakeAt("1h", "2026-10-20T00:00:00Z", now)).toThrow(/exactly one/);
    expect(() => wakeAt("sometime", undefined, now)).toThrow(/duration/);
    expect(() => wakeAt(undefined, "2026-10-18T00:00:00Z", now)).toThrow(/future/);
  });
});
