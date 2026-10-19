import { ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { createLocalDispatchSnapshot } from "./components/ChatView.logic";
import {
  createQueuedMessageStore,
  isQueuedMessageDue,
  latestCompletedToolActivityId,
  useQueuedMessageStore,
  type QueuedComposerMessage,
} from "./queuedMessageStore";
import type { QueuedMessageStorage } from "./queuedMessageStorage";

function makeMessage(prompt: string): Omit<QueuedComposerMessage, "id"> {
  return {
    prompt,
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    sendSettings: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      promptEffort: null,
    },
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

const queue = (threadKey: string) =>
  useQueuedMessageStore.getState().queuesByThreadKey[threadKey] ?? [];

describe("offline message durability", () => {
  function storage() {
    let saved: Record<string, QueuedComposerMessage[]> = {};
    return {
      read: async () => saved,
      write: async (messages: Record<string, QueuedComposerMessage[]>) => {
        saved = structuredClone(messages);
      },
    } satisfies QueuedMessageStorage;
  }

  it("restores offline messages in order, with their delivery identities", async () => {
    const disk = storage();
    const original = createQueuedMessageStore(disk);
    const first = await original.getState().enqueueDurable("thread-a", makeMessage("first"));
    await original.getState().enqueueDurable("thread-a", makeMessage("second"));
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();

    expect(
      restored.getState().queuesByThreadKey["thread-a"]?.map((message) => message.prompt),
    ).toEqual(["first", "second"]);
    expect(restored.getState().queuesByThreadKey["thread-a"]?.[0]?.id).toBe(first.id);
  });

  it("does not accept an offline message when saving fails", async () => {
    const store = createQueuedMessageStore({
      read: async () => ({}),
      write: async () => {
        throw new Error("Disk full");
      },
    });
    await expect(
      store.getState().enqueueDurable("thread-a", makeMessage("keep draft")),
    ).rejects.toThrow("Disk full");
    expect(store.getState().queuesByThreadKey).toEqual({});
  });

  it("keeps a recoverable send after restart without resending with a new ID", async () => {
    const disk = storage();
    const store = createQueuedMessageStore(disk);
    const message = await store.getState().enqueueDurable("thread-a", makeMessage("follow up"));
    store.getState().beginSend("thread-a", message.id, null);
    store
      .getState()
      .markDispatching("thread-a", message.id, createLocalDispatchSnapshot(undefined));
    await store.getState().flush();
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();

    expect(restored.getState().queuesByThreadKey["thread-a"]?.[0]).toMatchObject({
      id: message.id,
    });
    expect(restored.getState().queuesByThreadKey["thread-a"]?.[0]?.sending).toBeUndefined();
  });

  it("does not resurrect a canceled offline message", async () => {
    const disk = storage();
    const store = createQueuedMessageStore(disk);
    const message = await store.getState().enqueueDurable("thread-a", makeMessage("cancel me"));
    store.getState().remove("thread-a", message.id);
    await store.getState().flush();
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();
    expect(restored.getState().queuesByThreadKey).toEqual({});
  });

  it("keeps bootstrap work on the next message when the first message is canceled", async () => {
    const disk = storage();
    const store = createQueuedMessageStore(disk);
    const bootstrap = {
      prepareWorktree: { projectCwd: "/repo", baseBranch: "main", branch: "queued-branch" },
      runSetupScript: true,
    };
    const first = await store.getState().enqueueDurable("thread-a", {
      ...makeMessage("first"),
      bootstrap,
    });
    const second = await store.getState().enqueueDurable("thread-a", makeMessage("second"));
    store.getState().remove("thread-a", first.id);
    await store.getState().flush();
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();
    expect(restored.getState().queuesByThreadKey["thread-a"]).toEqual([
      expect.objectContaining({ id: second.id, bootstrap }),
    ]);
  });

  it("persists earlier busy-turn messages ahead of a newly queued offline message", async () => {
    const disk = storage();
    const store = createQueuedMessageStore(disk);
    store.getState().enqueue("thread-a", makeMessage("already waiting"));
    await store.getState().enqueueDurable("thread-a", makeMessage("offline follow up"));
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();
    expect(
      restored.getState().queuesByThreadKey["thread-a"]?.map((message) => message.prompt),
    ).toEqual(["already waiting", "offline follow up"]);
  });

  it("retains attachment bytes rather than only a temporary preview URL", async () => {
    const disk = storage();
    const store = createQueuedMessageStore(disk);
    await store.getState().enqueueDurable("thread-a", {
      ...makeMessage("with a file"),
      files: [
        {
          type: "file",
          id: "file-a",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          file: new File(["notes"], "notes.txt", { type: "text/plain" }),
        },
      ],
    });
    const restored = createQueuedMessageStore(disk);
    await restored.getState().hydrate();
    expect(
      await restored.getState().queuesByThreadKey["thread-a"]?.[0]?.files[0]?.file?.text(),
    ).toBe("notes");
  });
});

describe("queuedMessageStore", () => {
  beforeEach(() => {
    useQueuedMessageStore.setState({ queuesByThreadKey: {}, lastDispatchByThreadKey: {} });
  });

  it("keeps messages in submission order per thread", () => {
    const { enqueue } = useQueuedMessageStore.getState();
    enqueue("thread-a", makeMessage("first"));
    enqueue("thread-a", makeMessage("second"));
    enqueue("thread-b", makeMessage("other"));

    expect(queue("thread-a").map((message) => message.prompt)).toEqual(["first", "second"]);
    expect(queue("thread-b").map((message) => message.prompt)).toEqual(["other"]);
  });

  it("allows one send per thread and re-anchors the rest to the current tool boundary", () => {
    const { enqueue, beginSend } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", makeMessage("first"));
    const second = enqueue("thread-a", makeMessage("second"));

    expect(beginSend("thread-a", first.id, "tool-2")?.prompt).toBe("first");
    expect(beginSend("thread-a", first.id, "tool-2")).toBeNull();
    expect(beginSend("thread-a", second.id, "tool-2")).toBeNull();

    const [sending, waiting] = queue("thread-a");
    expect(sending?.sending).toBe("preparing");
    expect(waiting?.queuedAfterToolActivityId).toBe("tool-2");
    expect(
      isQueuedMessageDue({ message: waiting!, phase: "running", latestToolActivityId: "tool-2" }),
    ).toBe(false);
  });

  it("finishSend drops the sent message", () => {
    const { enqueue, beginSend, finishSend } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", makeMessage("first"));
    beginSend("thread-a", first.id, null);

    finishSend("thread-a", first.id);

    expect(useQueuedMessageStore.getState().queuesByThreadKey["thread-a"]).toBeUndefined();
  });

  it("failSend returns the message to the head, held", () => {
    const { enqueue, beginSend, failSend } = useQueuedMessageStore.getState();
    enqueue("thread-a", makeMessage("first"));
    const second = enqueue("thread-a", makeMessage("second"));
    beginSend("thread-a", second.id, null);

    expect(failSend("thread-a", second.id)).toBe(true);

    const [head] = queue("thread-a");
    expect(queue("thread-a").map((message) => message.prompt)).toEqual(["second", "first"]);
    expect(head?.sending).toBeUndefined();
    expect(isQueuedMessageDue({ message: head!, phase: "ready", latestToolActivityId: null })).toBe(
      false,
    );
  });

  it("remove keeps the other messages' anchors and refuses a message being sent", () => {
    const { enqueue, remove, beginSend } = useQueuedMessageStore.getState();
    const first = enqueue("thread-a", { ...makeMessage("first"), queuedAfterToolActivityId: "t1" });
    const second = enqueue("thread-a", makeMessage("second"));

    expect(remove("thread-a", second.id)?.prompt).toBe("second");
    expect(remove("thread-a", second.id)).toBeNull();
    expect(queue("thread-a")).toEqual([first]);

    beginSend("thread-a", first.id, "t1");
    expect(remove("thread-a", first.id)).toBeNull();
  });

  it("a failed send keeps waiting on the dispatch before it", () => {
    const { enqueue, beginSend, markDispatching, finishSend, failSend } =
      useQueuedMessageStore.getState();
    const earlier = createLocalDispatchSnapshot(undefined);
    const first = enqueue("thread-a", makeMessage("first"));
    const second = enqueue("thread-a", makeMessage("second"));
    const third = enqueue("thread-a", makeMessage("third"));
    const lastDispatch = () => useQueuedMessageStore.getState().lastDispatchByThreadKey["thread-a"];
    beginSend("thread-a", first.id, null);
    markDispatching("thread-a", first.id, earlier);
    finishSend("thread-a", first.id);

    // Fails before its turn start went out: the first send is still the one to wait on.
    beginSend("thread-a", second.id, null);
    failSend("thread-a", second.id);
    expect(lastDispatch()?.thread).toBe(earlier);

    // Fails after going out: it never reached the server, so the first still counts.
    beginSend("thread-a", third.id, null);
    markDispatching("thread-a", third.id, { ...earlier, startedAt: "later" });
    failSend("thread-a", third.id);
    expect(lastDispatch()?.thread).toBe(earlier);
  });

  it("Stop takes back a preparing send but not one already dispatching", () => {
    const { enqueue, beginSend, markDispatching, drain, failSend } =
      useQueuedMessageStore.getState();
    const preparing = enqueue("thread-a", makeMessage("preparing"));
    enqueue("thread-a", makeMessage("waiting"));
    beginSend("thread-a", preparing.id, null);

    expect(drain("thread-a").map((message) => message.prompt)).toEqual(["preparing", "waiting"]);
    expect(markDispatching("thread-a", preparing.id, createLocalDispatchSnapshot(undefined))).toBe(
      false,
    );
    expect(failSend("thread-a", preparing.id)).toBe(false);

    const dispatching = enqueue("thread-b", makeMessage("dispatching"));
    enqueue("thread-b", makeMessage("waiting"));
    beginSend("thread-b", dispatching.id, null);
    expect(
      markDispatching("thread-b", dispatching.id, createLocalDispatchSnapshot(undefined)),
    ).toBe(true);

    expect(drain("thread-b").map((message) => message.prompt)).toEqual(["waiting"]);
    expect(queue("thread-b").map((message) => message.prompt)).toEqual(["dispatching"]);
  });
});

describe("queued message dispatch timing", () => {
  it("preserves an explicit steer intent when the host reconnects mid-turn", () => {
    expect(
      isQueuedMessageDue({
        message: { queuedAfterToolActivityId: "tool-a", sendImmediately: true },
        phase: "running",
        latestToolActivityId: "tool-a",
      }),
    ).toBe(true);
    expect(
      isQueuedMessageDue({
        message: { queuedAfterToolActivityId: "tool-a", sendImmediately: false },
        phase: "running",
        latestToolActivityId: "tool-a",
      }),
    ).toBe(false);
  });
  const activities = [
    { id: "a1", kind: "tool.started", sequence: 1, createdAt: "2026-01-01T00:00:01Z" },
    { id: "a2", kind: "tool.completed", sequence: 2, createdAt: "2026-01-01T00:00:02Z" },
    { id: "a3", kind: "tool.updated", sequence: 3, createdAt: "2026-01-01T00:00:03Z" },
  ];

  it("finds the newest completed tool call by sequence, not position", () => {
    expect(latestCompletedToolActivityId(activities)).toBe("a2");
    expect(latestCompletedToolActivityId([])).toBeNull();
    expect(
      latestCompletedToolActivityId([
        { id: "late", kind: "tool.completed", sequence: 9, createdAt: "2026-01-01T00:00:09Z" },
        { id: "early", kind: "tool.completed", sequence: 4, createdAt: "2026-01-01T00:00:04Z" },
      ]),
    ).toBe("late");
  });

  it("waits mid-turn until a tool call finishes after the message was queued", () => {
    const message = { queuedAfterToolActivityId: "a2" };
    expect(isQueuedMessageDue({ message, phase: "running", latestToolActivityId: "a2" })).toBe(
      false,
    );
    expect(isQueuedMessageDue({ message, phase: "running", latestToolActivityId: "a4" })).toBe(
      true,
    );
  });

  it("never auto-sends a message held for user action", () => {
    const message = { queuedAfterToolActivityId: null, holdUntilUserAction: true };
    expect(isQueuedMessageDue({ message, phase: "ready", latestToolActivityId: "a4" })).toBe(false);
  });

  it("is due as soon as the turn is over, but not while a send is connecting", () => {
    const message = { queuedAfterToolActivityId: "a2" };
    expect(isQueuedMessageDue({ message, phase: "ready", latestToolActivityId: "a2" })).toBe(true);
    expect(isQueuedMessageDue({ message, phase: "connecting", latestToolActivityId: "a4" })).toBe(
      false,
    );
  });
});
