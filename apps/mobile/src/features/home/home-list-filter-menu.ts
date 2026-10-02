import {
  type SidebarFilterModes,
  type SidebarFilterKind,
  type SidebarFilterMode,
  type SidebarPinFilter,
  sidebarFilterValueChecked,
  toggleSidebarFilterValues,
  matchesSidebarPinFilter,
  toggleSidebarPinFilter,
} from "@t3tools/client-runtime/state/sidebar-filters";
import type { EnvironmentId } from "@t3tools/contracts";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly onPress: () => void;
};

type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuItem[];
};

export type HomeListFilterMenuItem = HomeListFilterMenuAction | HomeListFilterMenuSubmenu;

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

export function buildHomeListFilterMenu(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentIds: readonly EnvironmentId[];
  readonly selectedProjectKeys: readonly string[];
  readonly pinnedFilter: SidebarPinFilter;
  readonly filterModes: SidebarFilterModes;
  readonly onFilterModeChange: (kind: SidebarFilterKind, mode: SidebarFilterMode) => void;
  readonly onEnvironmentChange: (environmentIds: readonly EnvironmentId[]) => void;
  readonly onProjectChange: (projectKeys: readonly string[]) => void;
  readonly onPinnedFilterChange: (filter: SidebarPinFilter) => void;
}): HomeListFilterMenu {
  const scopeMenu = (
    kind: "environment" | "project",
    values: readonly { readonly key: string; readonly label: string }[],
    keys: readonly string[],
    onChange: (keys: string[]) => void,
  ): HomeListFilterMenuSubmenu => {
    const mode = props.filterModes[kind];
    const all = values.every((value) => sidebarFilterValueChecked(value.key, keys, mode));
    return {
      type: "submenu",
      title: kind === "environment" ? "Environment" : "Project",
      items: [
        {
          type: "action",
          title: kind === "environment" ? "All environments" : "All projects",
          state: all ? "on" : "off",
          onPress: () => {
            props.onFilterModeChange(kind, all ? "include" : "exclude");
            onChange([]);
          },
        },
        ...values.map((value): HomeListFilterMenuAction => ({
          type: "action",
          title: value.label,
          state: sidebarFilterValueChecked(value.key, keys, mode) ? "on" : "off",
          onPress: () => {
            const next = toggleSidebarFilterValues(keys, mode, [value.key]);
            if (mode === "include" && values.every((value) => next.includes(value.key))) {
              props.onFilterModeChange(kind, "exclude");
              onChange([]);
            } else onChange(next);
          },
        })),
        {
          type: "submenu",
          title: "Only…",
          items: values.map((value) => ({
            type: "action",
            title: value.label,
            onPress: () => {
              props.onFilterModeChange(kind, "include");
              onChange([value.key]);
            },
          })),
        },
      ],
    };
  };
  return {
    title: "Thread list options",
    items: [
      scopeMenu(
        "environment",
        props.environments.map((environment) => ({
          key: environment.environmentId,
          label: environment.label,
        })),
        props.selectedEnvironmentIds,
        (keys) =>
          props.onEnvironmentChange(
            keys.map(
              (key) =>
                props.environments.find((environment) => environment.environmentId === key)!
                  .environmentId,
            ),
          ),
      ),
      ...(props.projects.length > 0
        ? [scopeMenu("project", props.projects, props.selectedProjectKeys, props.onProjectChange)]
        : []),
      {
        type: "submenu",
        title: "Conversations",
        items: [
          {
            type: "action",
            title: "All conversations",
            state: props.pinnedFilter === "all" ? "on" : "off",
            onPress: () =>
              props.onPinnedFilterChange(props.pinnedFilter === "all" ? "none" : "all"),
          },
          ...(["pinned", "unpinned"] as const).map((value): HomeListFilterMenuAction => ({
            type: "action",
            title: value === "pinned" ? "Pinned" : "Unpinned",
            state: matchesSidebarPinFilter(value === "pinned", props.pinnedFilter) ? "on" : "off",
            onPress: () =>
              props.onPinnedFilterChange(toggleSidebarPinFilter(props.pinnedFilter, value)),
          })),
          {
            type: "submenu",
            title: "Only…",
            items: (["pinned", "unpinned"] as const).map((value) => ({
              type: "action",
              title: value === "pinned" ? "Pinned" : "Unpinned",
              onPress: () => props.onPinnedFilterChange(value),
            })),
          },
        ],
      },
    ],
  };
}

/** Adapt the same filter actions to Android's native menu. */
export function buildHomeListFilterNativeMenu(
  props: Parameters<typeof buildHomeListFilterMenu>[0],
) {
  const menu = buildHomeListFilterMenu(props);
  const actionsById = new Map<string, () => void>();
  const convert = (
    items: readonly HomeListFilterMenuItem[],
    prefix: string,
  ): import("@react-native-menu/menu").MenuAction[] =>
    items.map((item, index) => {
      const id = `${prefix}:${index}`;
      if (item.type === "action") {
        actionsById.set(id, item.onPress);
        return { id, title: item.title, subtitle: item.subtitle, state: item.state };
      }
      return { id, title: item.title, subactions: convert(item.items, id) };
    });
  return {
    actions: convert(menu.items, "filter"),
    onAction: (id: string) => actionsById.get(id)?.(),
  };
}
