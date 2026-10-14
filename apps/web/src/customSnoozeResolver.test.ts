// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import { useCustomSnooze } from "./hooks/useCustomSnooze";
import type { SnoozeTimeResolveResult } from "@t3tools/contracts";

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useCustomSnooze>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(resolveText: Parameters<typeof useCustomSnooze>[0]) {
  function Consumer() {
    state = useCustomSnooze(resolveText);
    return null;
  }
  await act(async () => root.render(createElement(Consumer)));
}
it("keeps common durations local", async () => {
  const fallback = vi.fn();
  await mount(fallback);
  let result: string | null = null;
  await act(async () => {
    result = await state.resolve({ mode: "text", text: "1w" });
  });
  expect(result).toBe("2026-10-21T10:00:00.000Z");
  expect(fallback).not.toHaveBeenCalled();
});
it("delegates unsupported phrases with clock and timezone", async () => {
  const fallback = vi.fn().mockResolvedValue({ snoozedUntil: "2026-10-23T01:00:00.000Z" });
  await mount(fallback);
  let result: string | null = null;
  await act(async () => {
    result = await state.resolve({ mode: "text", text: " oct 23 " });
  });
  expect(result).toBe("2026-10-23T01:00:00.000Z");
  expect(fallback).toHaveBeenCalledWith({
    text: "oct 23",
    now: "2026-10-14T10:00:00.000Z",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});
it("ignores results after the input changes and prevents duplicate requests", async () => {
  let complete!: (value: SnoozeTimeResolveResult) => void;
  const fallback = vi.fn(
    () =>
      new Promise<SnoozeTimeResolveResult>((resolve) => {
        complete = resolve;
      }),
  );
  await mount(fallback);
  let request!: Promise<string | null>;
  await act(async () => {
    request = state.resolve({ mode: "text", text: "oct 23" });
  });
  expect(state.pending).toBe(true);
  expect(await state.resolve({ mode: "text", text: "oct 24" })).toBeNull();
  await act(async () => state.clearError());
  let result: string | null = "unresolved";
  await act(async () => {
    complete({ snoozedUntil: "2026-10-23T01:00:00.000Z" });
    result = await request;
  });
  expect(result).toBeNull();
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(state.pending).toBe(false);
});
it("reports parser failures and does not delegate invalid non-text input", async () => {
  const fallback = vi.fn().mockRejectedValue(new Error("Connect a Codex account"));
  await mount(fallback);
  await act(async () => {
    await state.resolve({ mode: "text", text: "oct 23" });
  });
  expect(state.error).toBe("Connect a Codex account");
  await act(async () => {
    await state.resolve({ mode: "duration", amount: "-2", unit: "days" });
  });
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(state.error).toBe("Enter a positive duration.");
});

it("ignores a response after the dialog closes", async () => {
  let complete!: (value: SnoozeTimeResolveResult) => void;
  await mount(
    () =>
      new Promise<SnoozeTimeResolveResult>((resolve) => {
        complete = resolve;
      }),
  );
  let request!: Promise<string | null>;
  await act(async () => {
    request = state.resolve({ mode: "text", text: "oct 23" });
  });
  await act(async () => root.unmount());
  let result: string | null = "unresolved";
  await act(async () => {
    complete({ snoozedUntil: "2026-10-23T01:00:00.000Z" });
    result = await request;
  });
  expect(result).toBeNull();
});
