import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

/** Retain history subscriptions without subscribing the worker to streamed tokens. */
export function createOpenThreadSyncAtom(input: {
  readonly threadsAtom: Atom.Atom<
    ReadonlyArray<Pick<EnvironmentThreadShell, "environmentId" | "id" | "archivedAt" | "settledAt">>
  >;
  readonly stateAtom: (environmentId: EnvironmentId, threadId: ThreadId) => Atom.Atom<unknown>;
}) {
  return Atom.make((get) => {
    let count = 0;
    for (const thread of get(input.threadsAtom)) {
      if (thread.archivedAt !== null || thread.settledAt !== null) continue;
      get.mount(input.stateAtom(thread.environmentId, thread.id));
      count += 1;
    }
    return count;
  }).pipe(Atom.withLabel("mobile:open-thread-sync"));
}
