import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { useOfflineOutbox, type OfflineOutboxTurn } from "../offlineOutbox";
import { sendOfflineOutboxTurn } from "../offlineOutboxSend";
import { useEnvironment } from "../state/environments";
import { useEnvironmentShellHasSnapshot } from "../state/shell";
import { toastManager } from "./ui/toast";

export function OfflineOutboxSender() {
  const turns = useOfflineOutbox(useShallow((state) => state.turns));
  const persistenceError = useOfflineOutbox((state) => state.persistenceError);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hydrates the persisted outbox from browser storage when its sender mounts
  useEffect(() => {
    void useOfflineOutbox
      .getState()
      .hydrate()
      .catch(() => undefined);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the external toast registry in step with outbox persistence failures
  useEffect(() => {
    if (!persistenceError) return;
    toastManager.add({
      id: "offline-outbox-storage-error",
      type: "error",
      title: "Could not save offline messages",
      description: persistenceError,
    });
  }, [persistenceError]);
  return turns.map((turn) => (
    <TurnSender
      key={turn.id}
      turn={turn}
      first={
        turns.find(
          (entry) => entry.environmentId === turn.environmentId && entry.threadId === turn.threadId,
        )?.id === turn.id
      }
    />
  ));
}

function TurnSender({ turn, first }: { turn: OfflineOutboxTurn; first: boolean }) {
  const environment = useEnvironment(turn.environmentId);
  const hasShellSnapshot = useEnvironmentShellHasSnapshot(turn.environmentId);
  const hydrated = useOfflineOutbox((state) => state.hydrated);
  const sending = useOfflineOutbox((state) => state.sendingIds.has(turn.id));
  const connected = environment?.connection.phase === "connected";
  const handledConnection = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries the external outbox once per environment connection
  useEffect(() => {
    if (!connected) {
      handledConnection.current = false;
      return;
    }
    if (handledConnection.current) return;
    handledConnection.current = true;
    if (turn.blockedReason !== "Waiting for connection") return;
    void useOfflineOutbox
      .getState()
      .retry(turn.id)
      .catch(() => undefined);
  }, [connected, turn.blockedReason, turn.id]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- dispatches ready persisted messages through the environment transport
  useEffect(() => {
    if (!first || !hydrated || !connected || !hasShellSnapshot || sending || turn.blockedReason)
      return;
    void sendOfflineOutboxTurn(turn.id);
  }, [first, hydrated, connected, hasShellSnapshot, sending, turn.blockedReason, turn.id]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the external toast registry in step with blocked persisted messages
  useEffect(() => {
    if (!turn.blockedReason || turn.blockedReason === "Waiting for connection") return;
    toastManager.add({
      id: `offline-outbox-failed:${turn.id}`,
      type: "error",
      title: "Queued message needs attention",
      description: turn.blockedReason,
    });
  }, [turn.blockedReason, turn.id]);
  return null;
}
