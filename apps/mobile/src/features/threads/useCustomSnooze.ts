import { useEffect, useRef, useState } from "react";
import type { SnoozeTimeResolveInput, SnoozeTimeResolveResult } from "@t3tools/contracts";
import {
  resolveCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";

/** Resolve custom snoozes locally first, falling back only for nonempty typed phrases. */
export function useCustomSnooze(
  resolveText: (input: SnoozeTimeResolveInput) => Promise<SnoozeTimeResolveResult>,
) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const clearError = () => {
    revision.current++;
    setError(null);
  };
  const resolve = async (input: CustomSnoozeInput): Promise<string | null> => {
    if (pendingRef.current) return null;
    const now = new Date();
    const local = resolveCustomSnooze(input, now);
    if (local) return local;
    if (input.mode !== "text" || !input.text.trim()) {
      setError(
        input.mode === "date"
          ? "Choose a valid date and time in the future."
          : input.mode === "duration"
            ? "Enter a positive duration."
            : "Enter a date or duration.",
      );
      return null;
    }
    const requestRevision = ++revision.current;
    pendingRef.current = true;
    setError(null);
    setPending(true);
    let resolved: string | null = null;
    try {
      const result = await resolveText({
        text: input.text.trim(),
        now: now.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (revision.current === requestRevision) {
        if (Date.parse(result.snoozedUntil) > Date.now()) {
          resolved = result.snoozedUntil;
        } else {
          setError("Choose a date and time in the future.");
        }
      }
    } catch (cause) {
      if (revision.current === requestRevision)
        setError(
          cause instanceof Error
            ? "detail" in cause && typeof cause.detail === "string"
              ? cause.detail
              : cause.message
            : "Could not interpret this date. Try Date and time.",
        );
    }
    pendingRef.current = false;
    // Unmount invalidates the result; React ignores a state update on an unmounted host.
    setPending(false);
    return resolved;
  };
  return { resolve, error, pending, clearError };
}
