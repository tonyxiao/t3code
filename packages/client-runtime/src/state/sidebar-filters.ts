export type SidebarFilterMode = "include" | "exclude";
export type SidebarFilterKind = "environment" | "project" | "pinned";
export type SidebarFilterModes = Readonly<Record<SidebarFilterKind, SidebarFilterMode>>;

export const DEFAULT_SIDEBAR_FILTER_MODES: SidebarFilterModes = {
  environment: "exclude",
  project: "exclude",
  pinned: "include",
};

/** Empty selections are unrestricted in either mode; active filters intersect. */
export function matchesSidebarFilter(
  matchesSelection: boolean | null,
  mode: SidebarFilterMode = "include",
): boolean {
  return matchesSelection === null || (mode === "exclude" ? !matchesSelection : matchesSelection);
}

export function sanitizeSidebarFilterModes(value: unknown): SidebarFilterModes {
  const modes = value && typeof value === "object" ? value : {};
  return {
    environment: "environment" in modes && modes.environment === "exclude" ? "exclude" : "include",
    project: "project" in modes && modes.project === "exclude" ? "exclude" : "include",
    pinned: "pinned" in modes && modes.pinned === "exclude" ? "exclude" : "include",
  };
}

/** A checked row always means included, even when we store only the exceptions. */
export function sidebarFilterValueChecked(
  key: string,
  keys: readonly string[],
  mode: SidebarFilterMode,
): boolean {
  return mode === "exclude" ? !keys.includes(key) : keys.includes(key);
}

export function toggleSidebarFilterValues(
  keys: readonly string[],
  mode: SidebarFilterMode,
  values: readonly string[],
): string[] {
  const checked = values.every((value) => sidebarFilterValueChecked(value, keys, mode));
  const next = new Set(keys);
  for (const value of values) {
    if (checked === (mode === "include")) next.delete(value);
    else next.add(value);
  }
  return [...next];
}

/** Base UI returns the All row alongside individual rows; distinguish its toggle from a row toggle. */
export function resolveSidebarFilterCheckboxSelection(
  keys: readonly string[],
  mode: SidebarFilterMode,
  available: readonly string[],
  nextValues: readonly string[],
) {
  const current = available.filter((key) => sidebarFilterValueChecked(key, keys, mode));
  const next = new Set(nextValues.filter((key) => key !== "all"));
  const wasAll = current.length === available.length;
  const isAll = nextValues.includes("all");
  if (wasAll !== isAll && current.length === next.size && current.every((key) => next.has(key))) {
    return { keys: [], mode: isAll ? ("exclude" as const) : ("include" as const) };
  }
  const catalog = new Set(available);
  if (mode === "exclude")
    return {
      keys: [
        ...keys.filter((key) => !catalog.has(key)),
        ...available.filter((key) => !next.has(key)),
      ],
      mode,
    };
  if (available.every((key) => next.has(key))) return { keys: [], mode: "exclude" as const };
  return { keys: [...next], mode };
}

export type SidebarPinFilter = "all" | "pinned" | "unpinned" | "none";

export function matchesSidebarPinFilter(pinned: boolean, filter: SidebarPinFilter): boolean {
  return filter === "all" || (filter === "pinned" && pinned) || (filter === "unpinned" && !pinned);
}

export function toggleSidebarPinFilter(
  filter: SidebarPinFilter,
  value: "pinned" | "unpinned",
): SidebarPinFilter {
  const pinned = matchesSidebarPinFilter(true, filter) !== (value === "pinned");
  const unpinned = matchesSidebarPinFilter(false, filter) !== (value === "unpinned");
  return pinned ? (unpinned ? "all" : "pinned") : unpinned ? "unpinned" : "none";
}
