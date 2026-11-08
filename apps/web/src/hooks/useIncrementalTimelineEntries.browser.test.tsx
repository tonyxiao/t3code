import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { useIncrementalTimelineEntries } from "./useIncrementalTimelineEntries";

it("keeps an unchanged timeline stable when its input containers are recreated", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const seen: unknown[] = [];

  function Probe({ tick }: { tick: number }) {
    const entries = useIncrementalTimelineEntries("thread", {
      visibleTurnItems: [],
      optimisticMessages: [],
      anchoredMessages: [],
      attachmentUrlById: new Map(),
      attempts: [],
      nodes: [],
      plans: [],
    });
    seen.push(entries);
    return <div>{tick}</div>;
  }

  try {
    await act(() => root.render(<Probe tick={0} />));
    await act(() => root.render(<Probe tick={1} />));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
