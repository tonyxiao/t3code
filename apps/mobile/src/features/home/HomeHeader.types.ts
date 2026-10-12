import {
  type SidebarFilterModes,
  type SidebarFilterKind,
  type SidebarFilterMode,
  type SidebarPinFilter,
} from "@t3tools/client-runtime/state/sidebar-filters";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export interface HomeHeaderProps {
  readonly environments: ReadonlyArray<HomeHeaderEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly searchQuery: string;
  readonly selectedEnvironmentIds: readonly EnvironmentId[];
  readonly selectedProjectKeys: readonly string[];
  readonly pinnedFilter: SidebarPinFilter;
  readonly filterModes: SidebarFilterModes;
  readonly onFilterModeChange: (kind: SidebarFilterKind, mode: SidebarFilterMode) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onEnvironmentChange: (environmentIds: readonly EnvironmentId[]) => void;
  readonly onProjectChange: (projectKeys: readonly string[]) => void;
  readonly onPinnedFilterChange: (filter: SidebarPinFilter) => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
}
