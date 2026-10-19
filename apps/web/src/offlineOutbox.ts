import {
  ProjectId,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
  type PreviewAnnotationPayload,
  type ThreadContextRecord,
} from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

import type { ComposerFileAttachment, ComposerImageAttachment } from "./composerDraftStore";
import type { TerminalContextDraft } from "./lib/terminalContext";
import type { ReviewCommentContext } from "./reviewCommentContext";

export interface OfflineOutboxTurn {
  id: string;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  createdAt: string;
  text: string;
  draftPrompt: string;
  legacyPromptEffort?: string | null;
  titleSeed: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  dispatchMode: "auto" | "queue" | "steer" | "restart" | "start";
  compactBeforeSend: boolean;
  images: ComposerImageAttachment[];
  files: ComposerFileAttachment[];
  terminalContexts: TerminalContextDraft[];
  previewAnnotations: PreviewAnnotationPayload[];
  reviewComments: ReviewCommentContext[];
  threadContexts: ThreadContextRecord[];
  bootstrap?: {
    createThread?: {
      projectId: ProjectId;
      title: string;
      modelSelection: ModelSelection;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
      branch: string | null;
      worktreePath: string | null;
      createdAt: string;
    };
    prepareWorktree?: {
      projectCwd: string;
      baseBranch: string;
      startFromOrigin?: boolean;
    };
    runSetupScript?: boolean;
  };
  blockedReason?: string;
}

export interface OfflineOutboxStorage {
  list(): Promise<OfflineOutboxTurn[]>;
  put(turn: OfflineOutboxTurn): Promise<void>;
  delete(id: string): Promise<void>;
}

const DATABASE_NAME = "t3code-message-outbox";
const STORE_NAME = "messages";

export function createOfflineOutboxStorage(): OfflineOutboxStorage {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 2);
      request.addEventListener("upgradeneeded", (event) => {
        const connection = request.result;
        if (!connection.objectStoreNames.contains(STORE_NAME))
          connection.createObjectStore(STORE_NAME);
        if (event.oldVersion < 2) {
          const store = request.transaction!.objectStore(STORE_NAME);
          const legacy = store.get("queues");
          legacy.addEventListener("success", () => {
            const queues = legacy.result as
              | Record<
                  string,
                  Array<{
                    id: string;
                    prompt: string;
                    createdAt: string;
                    images: ComposerImageAttachment[];
                    files: ComposerFileAttachment[];
                    terminalContexts: TerminalContextDraft[];
                    previewAnnotations: PreviewAnnotationPayload[];
                    reviewComments: ReviewCommentContext[];
                    sendSettings: Pick<
                      OfflineOutboxTurn,
                      "modelSelection" | "runtimeMode" | "interactionMode"
                    > & { promptEffort?: string | null };
                    bootstrap?: OfflineOutboxTurn["bootstrap"];
                    holdUntilUserAction?: boolean;
                  }>
                >
              | undefined;
            if (!queues) return;
            for (const [threadKey, messages] of Object.entries(queues)) {
              const thread = parseScopedThreadKey(threadKey);
              if (!thread) {
                request.transaction!.abort();
                return;
              }
              for (const message of messages) {
                store.put(
                  {
                    id: message.id,
                    environmentId: thread.environmentId,
                    threadId: thread.threadId,
                    projectId:
                      message.bootstrap?.createThread?.projectId ??
                      ProjectId.make("legacy-outbox-project"),
                    createdAt: message.createdAt,
                    text: message.prompt,
                    draftPrompt: message.prompt,
                    ...(message.sendSettings.promptEffort === undefined
                      ? {}
                      : { legacyPromptEffort: message.sendSettings.promptEffort }),
                    titleSeed: message.prompt.slice(0, 80) || "New thread",
                    modelSelection: message.sendSettings.modelSelection,
                    runtimeMode: message.sendSettings.runtimeMode,
                    interactionMode: message.sendSettings.interactionMode,
                    dispatchMode: "auto",
                    compactBeforeSend: false,
                    images: message.images,
                    files: message.files,
                    terminalContexts: message.terminalContexts,
                    previewAnnotations: message.previewAnnotations,
                    reviewComments: message.reviewComments,
                    threadContexts: [],
                    ...(message.holdUntilUserAction
                      ? {
                          blockedReason:
                            "This saved message was waiting for manual send. Review and retry it.",
                        }
                      : {}),
                    ...(message.bootstrap ? { bootstrap: message.bootstrap } : {}),
                  } satisfies OfflineOutboxTurn,
                  message.id,
                );
              }
            }
            store.delete("queues");
          });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () =>
        reject(new Error("Offline message storage is blocked.")),
      );
    }).catch((error: unknown) => {
      database = null;
      throw error;
    });
    return database;
  };
  const transact = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const connection = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = connection.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      transaction.addEventListener("complete", () => resolve(request.result));
      transaction.addEventListener("error", () => reject(transaction.error));
      transaction.addEventListener("abort", () => reject(transaction.error));
    });
  };
  return {
    list: async () => {
      const records = await transact("readonly", (store) => store.getAll());
      // Version 1 stored all queues under a single key. This version stores
      // individual turns so concurrent windows never overwrite one another.
      return records.filter(
        (record): record is OfflineOutboxTurn =>
          typeof record === "object" &&
          record !== null &&
          "environmentId" in record &&
          "id" in record,
      );
    },
    put: async (turn) => {
      await transact("readwrite", (store) => store.put(turn, turn.id));
    },
    delete: async (id) => {
      await transact("readwrite", (store) => store.delete(id));
    },
  };
}

interface OfflineOutboxState {
  turns: OfflineOutboxTurn[];
  hydrated: boolean;
  sendingIds: ReadonlySet<string>;
  persistenceError: string | null;
  hydrate(): Promise<void>;
  enqueue(turn: OfflineOutboxTurn): Promise<void>;
  begin(id: string): OfflineOutboxTurn | null;
  finish(id: string): Promise<void>;
  fail(id: string, reason: string, retryAfterReconnect: boolean): Promise<void>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<OfflineOutboxTurn | null>;
}

export function createOfflineOutbox(storage: OfflineOutboxStorage | null) {
  return create<OfflineOutboxState>()((set, get) => {
    let hydration: Promise<void> | null = null;
    const report = (error: unknown) => {
      set({ persistenceError: error instanceof Error ? error.message : String(error) });
      throw error;
    };
    const replace = (turn: OfflineOutboxTurn) =>
      set((state) => ({
        turns: state.turns.map((entry) => (entry.id === turn.id ? turn : entry)),
      }));
    return {
      turns: [],
      hydrated: storage === null,
      sendingIds: new Set(),
      persistenceError: null,
      hydrate: () => {
        if (storage === null) return Promise.resolve();
        hydration ??= storage
          .list()
          .then((saved) => {
            set((state) => ({
              turns: [
                ...new Map([...saved, ...state.turns].map((turn) => [turn.id, turn])).values(),
              ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
              hydrated: true,
              persistenceError: null,
            }));
          })
          .catch((error: unknown) => {
            hydration = null;
            report(error);
          });
        return hydration;
      },
      enqueue: async (turn) => {
        if (storage === null)
          throw new Error("IndexedDB is unavailable; keep this draft in the composer.");
        await get().hydrate();
        try {
          await storage.put(turn);
          set((state) => ({ turns: [...state.turns, turn], persistenceError: null }));
        } catch (error) {
          report(error);
        }
      },
      begin: (id) => {
        const state = get();
        const turn = state.turns.find((entry) => entry.id === id && !entry.blockedReason);
        if (!turn || state.sendingIds.has(id)) return null;
        set({ sendingIds: new Set([...state.sendingIds, id]) });
        return turn;
      },
      finish: async (id) => {
        try {
          await storage?.delete(id);
          set((state) => ({
            turns: state.turns.filter((turn) => turn.id !== id),
            sendingIds: new Set([...state.sendingIds].filter((entry) => entry !== id)),
            persistenceError: null,
          }));
        } catch (error) {
          report(error);
        }
      },
      fail: async (id, reason, retryAfterReconnect) => {
        const turn = get().turns.find((entry) => entry.id === id);
        if (!turn) return;
        const updated = {
          ...turn,
          blockedReason: retryAfterReconnect ? "Waiting for connection" : reason,
        };
        try {
          await storage?.put(updated);
          replace(updated);
        } catch (error) {
          report(error);
        } finally {
          set((state) => ({
            sendingIds: new Set([...state.sendingIds].filter((entry) => entry !== id)),
          }));
        }
      },
      retry: async (id) => {
        const turn = get().turns.find((entry) => entry.id === id);
        if (!turn) return;
        const { blockedReason: _blockedReason, ...ready } = turn;
        try {
          await storage?.put(ready);
          replace(ready);
        } catch (error) {
          report(error);
        }
      },
      remove: async (id) => {
        const turn = get().turns.find((entry) => entry.id === id);
        if (!turn || get().sendingIds.has(id)) return null;
        const next = get().turns.find(
          (entry) =>
            entry.id !== id &&
            entry.environmentId === turn.environmentId &&
            entry.threadId === turn.threadId,
        );
        if (turn.bootstrap && next && !next.bootstrap) {
          const promoted = { ...next, bootstrap: turn.bootstrap };
          try {
            await storage?.put(promoted);
            replace(promoted);
          } catch (error) {
            report(error);
          }
        }
        await get().finish(id);
        return turn;
      },
    };
  });
}

export const useOfflineOutbox = createOfflineOutbox(
  typeof indexedDB === "undefined" ? null : createOfflineOutboxStorage(),
);
