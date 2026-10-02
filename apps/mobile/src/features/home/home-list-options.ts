import {
  DEFAULT_SIDEBAR_FILTER_MODES,
  type SidebarFilterModes,
  type SidebarFilterKind,
  type SidebarFilterMode,
  type SidebarPinFilter,
} from "@t3tools/client-runtime/state/sidebar-filters";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { DEFAULT_SIDEBAR_PROJECT_SORT_ORDER } from "@t3tools/contracts";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { HomeProjectSortOrder } from "./homeThreadList";

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

function defaultHomeListOptions(): HomeListOptions {
  return {
    selectedEnvironmentIds: [],
    selectedProjectKeys: [],
    pinnedFilter: "all",
    filterModes: DEFAULT_SIDEBAR_FILTER_MODES,
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
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}>) {
  const [options, setOptions] = useState<HomeListOptions>(defaultHomeListOptions);
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
