import {
  matchesSidebarFilter,
  type SidebarFilterMode,
} from "@t3tools/client-runtime/state/sidebar-filters";
import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId } from "@t3tools/contracts";

import type { SidebarThreadStatusFilter } from "../uiStateStore";

export type LegacySidebarFilterableThread = ThreadSnoozeShell & {
  readonly archivedAt: string | null;
  readonly environmentId: EnvironmentId;
  readonly pinnedAt?: string | null | undefined;
  readonly settledOverride: "active" | "settled" | null;
};

export function legacySidebarThreadMatchesFilters(
  thread: LegacySidebarFilterableThread,
  input: {
    readonly environmentIds: readonly string[];
    readonly environmentMode?: SidebarFilterMode;
    readonly status: SidebarThreadStatusFilter;
    readonly now: string;
  },
): boolean {
  if (thread.archivedAt !== null) return false;
  if (
    !matchesSidebarFilter(
      input.environmentMode === undefined && input.environmentIds.length === 0
        ? null
        : input.environmentIds.includes(thread.environmentId),
      input.environmentMode,
    )
  )
    return false;
  if (input.status === "all") return true;
  if (input.status === "pinned") return thread.pinnedAt != null;
  if (input.status === "unpinned") return thread.pinnedAt == null;
  if (input.status === "none") return false;

  const status = effectiveSnoozed(thread, { now: input.now })
    ? "snoozed"
    : thread.settledOverride === "settled"
      ? "settled"
      : "active";
  return status === input.status;
}
