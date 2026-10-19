import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePanelNavigationSuppression, usePanelPresence } from "./panelAnimations";

let root: Root;
let pendingFrames: FrameRequestCallback[] = [];
let observed: boolean[] = [];

function SuppressionProbe({ navigationKey }: { navigationKey: string }) {
  const suppressed = usePanelNavigationSuppression(navigationKey);
  useLayoutEffect(() => {
    observed.push(suppressed);
  }, [suppressed]);
  return null;
}

beforeEach(() => {
  pendingFrames = [];
  observed = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Frames are stepped by hand so each assertion lands between two paints.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function paintPendingFrame() {
  const callback = pendingFrames.shift();
  await act(() => callback?.(0));
}

describe("usePanelNavigationSuppression", () => {
  it("suppresses initial and navigated panel state until each route has painted", async () => {
    await act(() => root.render(<SuppressionProbe navigationKey="/thread/one" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);

    await act(() => root.render(<SuppressionProbe navigationKey="/thread/two" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});

it("keeps an open panel stable when its value wrapper is recreated", async () => {
  const seen: string[] = [];

  function Probe({ tick }: { tick: number }) {
    const presence = usePanelPresence(true, { label: "Files" }, false, "thread", 0);
    seen.push(presence.value?.label ?? "missing");
    return <div>{tick}</div>;
  }

  await act(() => root.render(<Probe tick={0} />));
  await act(() => root.render(<Probe tick={1} />));
  expect(seen).toEqual(["Files", "Files"]);
});
