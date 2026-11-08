import { useAtomValue } from "@effect/atom-react";
import { requireOptionalNativeModule } from "expo";
import { useEffect } from "react";

import { createOpenThreadSyncAtom } from "./open-thread-sync";
import { environmentThreadShells, environmentThreads } from "./threads";

const openThreadSyncAtom = createOpenThreadSyncAtom({
  threadsAtom: environmentThreadShells.threadShellsAtom,
  stateAtom: environmentThreads.stateAtom,
});

export function useOpenThreadSync() {
  const count = useAtomValue(openThreadSyncAtom);
  const enabled = count > 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the native background-sync module enabled while open threads need it
  useEffect(() => {
    // Older installed clients can receive this JS via OTA before a native rebuild.
    const native = requireOptionalNativeModule<{
      setEnabled(enabled: boolean): void;
    }>("T3BackgroundSync");
    native?.setEnabled(enabled);
    return () => native?.setEnabled(false);
  }, [enabled]);
}
