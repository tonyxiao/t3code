import { render } from "../../test/render";
import { expect, it } from "vite-plus/test";

import { useIncrementalTimelineEntries } from "./useIncrementalTimelineEntries";

it("keeps an unchanged timeline stable when its input containers are recreated", async () => {
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

  await using screen = await render(<Probe tick={0} />);
  await screen.rerender(<Probe tick={1} />);
  expect(seen).toHaveLength(2);
  expect(seen[1]).toBe(seen[0]);
});
