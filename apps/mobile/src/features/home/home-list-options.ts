import {
  DEFAULT_SIDEBAR_FILTER_MODES,
  type SidebarFilterModes,
  type SidebarFilterKind,
  type SidebarFilterMode,
  type SidebarPinFilter,
} from "@t3tools/client-runtime/state/sidebar-filters";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { DEFAULT_SIDEBAR_PROJECT_SORT_ORDER } from "@t3tools/contracts";
import { useAtomSet } from "@effect/atom-react";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { HomeProjectSortOrder } from "./homeThreadList";
import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";

export interface HomeListOptions {
  readonly selectedProjectKeys: readonly string[];
  readonly selectedEnvironmentIds: readonly EnvironmentId[];
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly pinnedFilter: SidebarPinFilter;
  readonly filterModes: SidebarFilterModes;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

function defaultHomeListOptions(saved?: ThreadListFilters): HomeListOptions {
  const selectedEnvironmentIds =
    saved?.environmentIds ?? (saved?.environmentId ? [saved.environmentId] : []);
  const selectedProjectKeys = saved?.projectKeys ?? (saved?.projectKey ? [saved.projectKey] : []);
  return {
    selectedEnvironmentIds,
    selectedProjectKeys,
    pinnedFilter: saved?.pinnedFilter ?? "all",
    filterModes: {
      ...DEFAULT_SIDEBAR_FILTER_MODES,
      environment:
        saved?.environmentMode ?? (selectedEnvironmentIds.length ? "include" : "exclude"),
      project: saved?.projectMode ?? (selectedProjectKeys.length ? "include" : "exclude"),
    },
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  };
}

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly setOptions: Dispatch<SetStateAction<HomeListOptions>>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}

const HomeListOptionsContext = createContext<HomeListOptionsContextValue | null>(null);

/** Keeps list preferences stable while the app moves between compact and split shells. */
export function HomeListOptionsProvider({
  children,
  projectGroupingMode,
  savedFilters,
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly savedFilters?: ThreadListFilters | undefined;
}>) {
  const [options, setOptions] = useState<HomeListOptions>(() =>
    defaultHomeListOptions(savedFilters),
  );
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const saved = useRef(savedFilters);
  useEffect(() => {
    const next: ThreadListFilters = {
      environmentIds: [...options.selectedEnvironmentIds],
      projectKeys: [...options.selectedProjectKeys],
      environmentMode: options.filterModes.environment,
      projectMode: options.filterModes.project,
      pinnedFilter: options.pinnedFilter,
    };
    if (
      saved.current === undefined &&
      next.environmentIds?.length === 0 &&
      next.projectKeys?.length === 0 &&
      next.environmentMode === "exclude" &&
      next.projectMode === "exclude" &&
      next.pinnedFilter === "all"
    )
      return;
    if (JSON.stringify(saved.current) === JSON.stringify(next)) return;
    saved.current = next;
    savePreferences({ threadListFilters: next });
  }, [
    options.selectedEnvironmentIds,
    options.selectedProjectKeys,
    options.filterModes,
    options.pinnedFilter,
    savePreferences,
  ]);
  const value = useMemo(
    () => ({ options, setOptions, projectGroupingMode }),
    [options, projectGroupingMode],
  );
  return createElement(HomeListOptionsContext, { value }, children);
}

export function useHomeListOptions(availableEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const shared = useContext(HomeListOptionsContext);
  const [localOptions, setLocalOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const options = shared?.options ?? localOptions;
  const setOptions = shared?.setOptions ?? setLocalOptions;
  const remainingEnvironmentIds = options.selectedEnvironmentIds.filter((id) =>
    availableEnvironmentIds.has(id),
  );
  const environmentsRemoved =
    remainingEnvironmentIds.length !== options.selectedEnvironmentIds.length;
  const resolvedOptions: ResolvedHomeListOptions = {
    ...options,
    selectedEnvironmentIds: environmentsRemoved
      ? remainingEnvironmentIds
      : options.selectedEnvironmentIds,
    filterModes:
      environmentsRemoved && remainingEnvironmentIds.length === 0
        ? { ...options.filterModes, environment: "exclude" }
        : options.filterModes,
    projectGroupingMode: shared?.projectGroupingMode ?? "repository",
  };

  const setSelectedEnvironmentIds = useCallback(
    (value: readonly EnvironmentId[]) => {
      setOptions((current) => ({ ...current, selectedEnvironmentIds: value }));
    },
    [setOptions],
  );
  const setSelectedProjectKeys = useCallback(
    (value: readonly string[]) => {
      setOptions((current) => ({ ...current, selectedProjectKeys: value }));
    },
    [setOptions],
  );
  const setProjectSortOrder = useCallback(
    (value: HomeProjectSortOrder) => {
      setOptions((current) => ({ ...current, projectSortOrder: value }));
    },
    [setOptions],
  );
  const setPinnedFilter = useCallback(
    (value: SidebarPinFilter) => {
      setOptions((current) => ({ ...current, pinnedFilter: value }));
    },
    [setOptions],
  );
  const setFilterMode = useCallback(
    (kind: SidebarFilterKind, mode: SidebarFilterMode) => {
      setOptions((current) => ({
        ...current,
        filterModes: { ...current.filterModes, [kind]: mode },
      }));
    },
    [setOptions],
  );
  return {
    setFilterMode,
    options: resolvedOptions,
    setSelectedEnvironmentIds,
    setSelectedProjectKeys,
    setProjectSortOrder,
    setPinnedFilter,
  } as const;
}
