import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  isQueuedMessageDue,
  latestCompletedToolActivityId,
  useQueuedMessageStore,
  useQueuedMessages,
} from "../queuedMessageStore";
import { derivePhase } from "../session-logic";
import { useServerConfigs, useThread, useThreadStatus } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { hasServerAcknowledgedLocalDispatch, latestTurnStartFailureId } from "./ChatView.logic";
import { sendQueuedMessage } from "./chat/sendQueuedMessage";
import { toastManager } from "./ui/toast";

/**
 * Sends queued messages when they are due, for every thread with a queue,
 * whether or not the thread is on screen. Mounted once at the root.
 */
export function QueuedMessageSender() {
  const persistenceError = useQueuedMessageStore((state) => state.persistenceError);
  useEffect(() => {
    void useQueuedMessageStore
      .getState()
      .hydrate()
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (persistenceError === null) return;
    toastManager.add({
      id: "queued-message-storage-error",
      type: "error",
      title: "Could not save the message queue",
      description: "Keep this window open. Offline messages may not survive a restart.",
    });
  }, [persistenceError]);
  const threadKeys = useQueuedMessageStore(
    useShallow((state) => Object.keys(state.queuesByThreadKey)),
  );
  return threadKeys.map((threadKey) => <ThreadQueueSender key={threadKey} threadKey={threadKey} />);
}

/**
 * Watches one thread while it has queued messages. Reading the thread keeps
 * its detail subscribed, so tool boundaries and the end of the turn are
 * visible while the user is elsewhere.
 */
function ThreadQueueSender({ threadKey }: { threadKey: string }) {
  const threadRef = useMemo(() => parseScopedThreadKey(threadKey), [threadKey]);
  const thread = useThread(threadRef);
  const threadStatus = useThreadStatus(threadRef);
  const environmentId = threadRef?.environmentId ?? null;
  const environment = useEnvironment(environmentId);
  const serverConfigs = useServerConfigs();
  const serverConfigLoaded = environmentId !== null && serverConfigs.has(environmentId);
  const rewinding = useComposerDraftStore((store) => store.rewindingThreadKeys.has(threadKey));
  const queue = useQueuedMessages(threadKey);
  const next = queue[0];
  const hydrated = useQueuedMessageStore((state) => state.hydrated);
  useEffect(() => {
    if (environment?.connection.phase === "connected" || !next?.waitingForConnection) return;
    useQueuedMessageStore.getState().resumeAfterDisconnect(threadKey);
  }, [environment?.connection.phase, next?.waitingForConnection, threadKey]);
  const sending = queue.some((message) => message.sending);
  const activities = thread?.activities;
  const latestToolActivityId = useMemo(
    () => latestCompletedToolActivityId(activities ?? []),
    [activities],
  );
  const pendingRequests = useMemo(() => derivePendingRequests(activities ?? []), [activities]);
  const phase = derivePhase(thread?.session ?? null);

  // A send that starts a new turn leaves the thread idle until the server
  // picks it up. Hold the next message until then, as the composer does for
  // its own sends.
  const lastDispatch = useQueuedMessageStore(
    (state) => state.lastDispatchByThreadKey[threadKey]?.thread ?? null,
  );
  const latestUserMessageId = thread?.messages.findLast((m) => m.role === "user")?.id ?? null;
  const waitingForServer =
    lastDispatch !== null &&
    !hasServerAcknowledgedLocalDispatch({
      localDispatch: lastDispatch,
      phase,
      latestTurn: thread?.latestTurn ?? null,
      latestUserMessageId,
      session: thread?.session ?? null,
      hasPendingApproval: pendingRequests.approvals.length > 0,
      hasPendingUserInput: pendingRequests.userInputs.length > 0,
      latestTurnStartFailureId: latestTurnStartFailureId(thread ?? undefined, latestUserMessageId),
      threadError: null,
    });

  // Approvals and questions block the agent; a steer landing on top of them
  // would answer nothing and confuse the turn, so the queue holds until the
  // user resolves them.
  const blocked =
    threadRef === null ||
    !hydrated ||
    ((thread === null || threadStatus !== "live") && !next?.bootstrap?.createThread) ||
    environment?.connection.phase !== "connected" ||
    next?.waitingForConnection === true ||
    !serverConfigLoaded ||
    rewinding ||
    sending ||
    waitingForServer ||
    pendingRequests.approvals.length > 0 ||
    pendingRequests.userInputs.length > 0;
  const due =
    next !== undefined &&
    !blocked &&
    isQueuedMessageDue({ message: next, phase, latestToolActivityId });
  const nextId = next?.id;
  useEffect(() => {
    if (!due || !threadRef || nextId === undefined) return;
    void sendQueuedMessage(threadRef, nextId);
  }, [due, nextId, threadRef]);
  return null;
}
