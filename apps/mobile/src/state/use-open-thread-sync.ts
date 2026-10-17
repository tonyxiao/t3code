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
  useEffect(() => {
    // Older installed clients can receive this JS via OTA before a native rebuild.
    const native = requireOptionalNativeModule<{
      setEnabled(enabled: boolean): void;
    }>("T3BackgroundSync");
    native?.setEnabled(enabled);
    return () => native?.setEnabled(false);
  }, [enabled]);
}
