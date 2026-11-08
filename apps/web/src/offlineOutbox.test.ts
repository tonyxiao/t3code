import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import {
  createOfflineOutbox,
  type OfflineOutboxStorage,
  type OfflineOutboxTurn,
} from "./offlineOutbox";

const turn: OfflineOutboxTurn = {
  id: "message-1",
  environmentId: EnvironmentId.make("remote"),
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("draft"),
  createdAt: "2026-10-19T00:00:00.000Z",
  text: "Work offline",
  draftPrompt: "Work offline",
  titleSeed: "Work offline",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  dispatchMode: "auto",
  compactBeforeSend: false,
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [],
  bootstrap: {
    createThread: {
      projectId: ProjectId.make("project"),
      title: "Work offline",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-10-19T00:00:00.000Z",
    },
  },
};

function storage() {
  const saved = new Map<string, OfflineOutboxTurn>();
  const adapter: OfflineOutboxStorage = {
    list: async () => [...saved.values()],
    put: async (item) => {
      saved.set(item.id, item);
    },
    delete: async (id) => {
      saved.delete(id);
    },
  };
  return { saved, adapter };
}

describe("offline outbox", () => {
  it("persists the complete turn before exposing it for send and hydrates it after reload", async () => {
    const { saved, adapter } = storage();
    const first = createOfflineOutbox(adapter);
    await first.getState().enqueue(turn);
    expect(saved.get(turn.id)).toEqual(turn);
    const reloaded = createOfflineOutbox(adapter);
    await reloaded.getState().hydrate();
    expect(reloaded.getState().turns).toEqual([turn]);
    expect(reloaded.getState().begin(turn.id)?.id).toBe(turn.id);
    await reloaded.getState().finish(turn.id);
    expect(saved.has(turn.id)).toBe(false);
  });

  it("leaves the composer copy intact when durable storage rejects a write", async () => {
    const store = createOfflineOutbox({
      list: async () => [],
      put: async () => {
        throw new Error("disk full");
      },
      delete: async () => undefined,
    });
    await expect(store.getState().enqueue(turn)).rejects.toThrow("disk full");
    expect(store.getState().turns).toEqual([]);
    expect(store.getState().persistenceError).toBe("disk full");
  });

  it("moves a draft bootstrap to the next queued turn when the first is restored", async () => {
    const { saved, adapter } = storage();
    const store = createOfflineOutbox(adapter);
    await store.getState().enqueue(turn);
    const { bootstrap: _bootstrap, ...followingTurn } = turn;
    await store.getState().enqueue({ ...followingTurn, id: "message-2" });
    expect(await store.getState().remove(turn.id)).toEqual(turn);
    expect(saved.get("message-2")?.bootstrap).toEqual(turn.bootstrap);
    expect(saved.has(turn.id)).toBe(false);
  });

  it("holds a rejected send for manual retry while preserving its command id", async () => {
    const { adapter } = storage();
    const store = createOfflineOutbox(adapter);
    await store.getState().enqueue(turn);
    expect(store.getState().begin(turn.id)?.id).toBe(turn.id);
    await store.getState().fail(turn.id, "Permission denied", false);
    expect(store.getState().begin(turn.id)).toBeNull();
    await store.getState().retry(turn.id);
    expect(store.getState().begin(turn.id)?.id).toBe(turn.id);
  });

  it("releases the in-flight lock if recording a send failure runs out of space", async () => {
    let rejectWrites = false;
    const store = createOfflineOutbox({
      list: async () => [],
      put: async () => {
        if (rejectWrites) throw new Error("disk full");
      },
      delete: async () => undefined,
    });
    await store.getState().enqueue(turn);
    expect(store.getState().begin(turn.id)?.id).toBe(turn.id);
    rejectWrites = true;
    await expect(store.getState().fail(turn.id, "Disconnected", true)).rejects.toThrow("disk full");
    expect(store.getState().sendingIds.has(turn.id)).toBe(false);
    expect(store.getState().persistenceError).toBe("disk full");
  });
});
