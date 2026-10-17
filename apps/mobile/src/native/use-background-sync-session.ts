import { type EventSubscription, requireOptionalNativeModule } from "expo";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

interface SyncSessionStatus {
  readonly endsAt: number | null;
  readonly state: "idle" | "requested" | "running" | "completed" | "cancelled" | "expired";
}

interface BackgroundSyncModule {
  addListener(
    event: "onSessionChange",
    listener: (status: SyncSessionStatus) => void,
  ): EventSubscription;
  getSessionStatus(): Promise<SyncSessionStatus>;
  startSession(): Promise<void>;
  cancelSession(): Promise<void>;
}

const IDLE_SESSION: SyncSessionStatus = { endsAt: null, state: "idle" };

export function useBackgroundSyncSession() {
  const native =
    Platform.OS === "ios"
      ? requireOptionalNativeModule<BackgroundSyncModule>("T3BackgroundSync")
      : null;
  const supported =
    Platform.OS === "ios" &&
    Number.parseFloat(String(Platform.Version)) >= 26 &&
    typeof native?.startSession === "function";
  const revision = useRef(0);
  const busy = useRef(false);
  const [status, setStatus] = useState(IDLE_SESSION);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || !native) return;
    const initialRevision = revision.current;
    let disposed = false;
    const subscription = native.addListener("onSessionChange", (next) => {
      revision.current += 1;
      setStatus(next);
    });
    void native
      .getSessionStatus()
      .then((next) => {
        if (!disposed && revision.current === initialRevision) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [native, supported]);

  const toggle = async () => {
    if (!supported || !native || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (status.endsAt !== null) await native.cancelSession();
      else await native.startSession();
      // Native events also update this when the OS cancels or expires the task.
      const currentRevision = revision.current;
      const next = await native.getSessionStatus();
      if (revision.current === currentRevision) setStatus(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start background sync.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return { supported, status, pending, error, toggle };
}
