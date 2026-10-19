import type { QueuedComposerMessage } from "./queuedMessageStore";

export interface QueuedMessageStorage {
  read: () => Promise<Record<string, QueuedComposerMessage[]>>;
  write: (queues: Record<string, QueuedComposerMessage[]>) => Promise<void>;
}

export function createQueuedMessageStorage(): QueuedMessageStorage {
  let database: Promise<IDBDatabase> | null = null;
  const knownMessageIds = new Set<string>();
  const open = () => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("t3code-message-outbox", 1);
      request.addEventListener("upgradeneeded", () => request.result.createObjectStore("messages"));
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
      request.addEventListener("blocked", () =>
        reject(new Error("Offline message storage is blocked by another window.")),
      );
    }).catch((error: unknown) => {
      database = null;
      throw error;
    });
    return database;
  };
  return {
    read: async () => {
      const connection = await open();
      const queues = await new Promise<Record<string, QueuedComposerMessage[]>>(
        (resolve, reject) => {
          const transaction = connection.transaction("messages", "readonly");
          const request = transaction.objectStore("messages").get("queues");
          transaction.addEventListener("complete", () => resolve(request.result ?? {}));
          transaction.addEventListener("error", () => reject(transaction.error));
          transaction.addEventListener("abort", () => reject(transaction.error));
        },
      );
      for (const message of Object.values(queues).flat()) knownMessageIds.add(message.id);
      return Object.fromEntries(
        Object.entries(queues).map(([threadKey, messages]) => [
          threadKey,
          messages.map((message) => ({
            ...message,
            images: message.images.map((image) => ({
              ...image,
              previewUrl: URL.createObjectURL(image.file),
            })),
          })),
        ]),
      );
    },
    write: async (queues) => {
      const connection = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = connection.transaction("messages", "readwrite");
        const store = transaction.objectStore("messages");
        const request = store.get("queues");
        request.addEventListener("success", () => {
          const saved: Record<string, QueuedComposerMessage[]> = request.result ?? {};
          const savedIds = new Set(
            Object.values(saved)
              .flat()
              .map((message) => message.id),
          );
          const merged = Object.fromEntries(
            [...new Set([...Object.keys(saved), ...Object.keys(queues)])].map((threadKey) => [
              threadKey,
              [
                ...(saved[threadKey] ?? []).filter((message) => !knownMessageIds.has(message.id)),
                ...(queues[threadKey] ?? []).filter(
                  (message) => !knownMessageIds.has(message.id) || savedIds.has(message.id),
                ),
              ].sort((first, second) => first.createdAt.localeCompare(second.createdAt)),
            ]),
          );
          store.put(merged, "queues");
        });
        transaction.addEventListener("complete", () => {
          for (const message of Object.values(queues).flat()) knownMessageIds.add(message.id);
          resolve();
        });
        transaction.addEventListener("error", () => reject(transaction.error));
        transaction.addEventListener("abort", () => reject(transaction.error));
      });
    },
  };
}
