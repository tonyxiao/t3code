import type { EnvironmentId } from "@t3tools/contracts";
import { useCustomSnooze } from "./useCustomSnooze";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function useSnoozeResolver(environmentId: EnvironmentId) {
  const resolveSnoozeTime = useAtomCommand(serverEnvironment.resolveSnoozeTime, {
    reportFailure: false,
  });
  return useCustomSnooze(async (input) => {
    const result = await resolveSnoozeTime({ environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  });
}
