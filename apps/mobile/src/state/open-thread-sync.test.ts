import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";

import { createOpenThreadSyncAtom } from "./open-thread-sync";

function thread(
  environment: string,
  id: string,
  settledAt: string | null = null,
  archivedAt: string | null = null,
) {
  return {
    environmentId: EnvironmentId.make(environment),
    id: ThreadId.make(id),
    settledAt,
    archivedAt,
  };
}

function harness(initial: ReturnType<typeof thread>[]) {
  const scheduled = new Set<() => void>();
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      scheduled.add(task);
      return () => {
        scheduled.delete(task);
      };
    },
  });
  const flush = () => {
    while (scheduled.size > 0) {
      const tasks = [...scheduled];
      scheduled.clear();
      tasks.forEach((task) => task());
    }
  };
  const threadsAtom = Atom.make(initial);
  const mounted = new Set<string>();
  const histories = Atom.family((key: string) =>
    Atom.make((get) => {
      mounted.add(key);
      get.addFinalizer(() => mounted.delete(key));
      return Atom.make("cached");
    }),
  );
  const sync = createOpenThreadSyncAtom({
    threadsAtom,
    stateAtom: (environmentId, threadId) => histories(`${environmentId}/${threadId}`),
  });
  const stop = registry.mount(sync);
  return { registry, threadsAtom, mounted, sync, stop, histories, flush };
}

describe("open thread sync", () => {
  it("syncs open histories across environments without opening a chat", () => {
    const h = harness([
      thread("one", "chat"),
      thread("two", "chat"),
      thread("one", "settled", "2026-10-17"),
      thread("one", "archived", null, "2026-10-17"),
    ]);
    try {
      expect(h.registry.get(h.sync)).toBe(2);
      expect([...h.mounted]).toEqual(["one/chat", "two/chat"]);
    } finally {
      h.registry.dispose();
    }
  });

  it("releases settled, archived, removed, and disabled-environment histories and follows reopened threads", () => {
    const h = harness([
      thread("one", "settle"),
      thread("one", "archive"),
      thread("two", "disable"),
    ]);
    try {
      h.registry.set(h.threadsAtom, [
        thread("one", "settle", "2026-10-17"),
        thread("one", "archive", null, "2026-10-17"),
      ]);
      expect(h.registry.get(h.sync)).toBe(0);
      h.flush();
      expect([...h.mounted]).toEqual([]);
      h.registry.set(h.threadsAtom, [thread("one", "settle")]);
      expect(h.registry.get(h.sync)).toBe(1);
      expect([...h.mounted]).toEqual(["one/settle"]);
      h.stop();
      h.flush();
      expect([...h.mounted]).toEqual([]);
    } finally {
      h.registry.dispose();
    }
  });

  it("shares the chat's subscription and retains it when the chat closes", () => {
    const h = harness([thread("one", "chat")]);
    try {
      const closeChat = h.registry.mount(h.histories("one/chat"));
      expect(h.mounted.size).toBe(1);
      closeChat();
      expect(h.mounted.size).toBe(1);
    } finally {
      h.registry.dispose();
    }
  });
});
