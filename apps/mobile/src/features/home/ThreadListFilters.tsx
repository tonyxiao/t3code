import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import { buildHomeListFilterNativeMenu } from "./home-list-filter-menu";
import type { HomeHeaderProps } from "./HomeHeader.types";

type FilterProps = Pick<
  HomeHeaderProps,
  | "environments"
  | "projects"
  | "selectedEnvironmentIds"
  | "selectedProjectKeys"
  | "pinnedFilter"
  | "filterModes"
  | "onEnvironmentChange"
  | "onProjectChange"
  | "onPinnedFilterChange"
  | "onFilterModeChange"
>;

export function ThreadListFilters(props: FilterProps) {
  const menu = buildHomeListFilterNativeMenu(props);
  const environmentLabel =
    props.selectedEnvironmentIds.length === 1
      ? props.environments.find((item) => item.environmentId === props.selectedEnvironmentIds[0])
          ?.label
      : props.selectedEnvironmentIds.length > 1
        ? `${props.selectedEnvironmentIds.length} environments`
        : "All environments";
  const projectLabel =
    props.selectedProjectKeys.length === 1
      ? props.projects.find((item) => item.key === props.selectedProjectKeys[0])?.label
      : props.selectedProjectKeys.length > 1
        ? `${props.selectedProjectKeys.length} projects`
        : "All projects";
  const activeEnvironment =
    props.selectedEnvironmentIds.length > 0 || props.filterModes.environment === "include";
  const activeProject =
    props.selectedProjectKeys.length > 0 || props.filterModes.project === "include";
  const active = activeEnvironment || activeProject || props.pinnedFilter !== "all";
  const actionsFor = (title: string) =>
    menu.actions.find((action) => action.title === title)?.subactions ?? [];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={environmentLabel ?? "Environments"}
        accessibilityLabel="Filter threads by environment"
        active={activeEnvironment}
        actions={actionsFor("Environment")}
        onSelect={menu.onAction}
      />
      <ListFilterMenu
        label={projectLabel ?? "Projects"}
        accessibilityLabel="Filter threads by project"
        active={activeProject}
        actions={actionsFor("Project")}
        onSelect={menu.onAction}
      />
      <ListFilterMenu
        label={
          props.pinnedFilter === "all"
            ? "All conversations"
            : props.pinnedFilter === "pinned"
              ? "Pinned"
              : props.pinnedFilter === "unpinned"
                ? "Unpinned"
                : "No conversations"
        }
        accessibilityLabel="Filter threads by pin"
        active={props.pinnedFilter !== "all"}
        actions={actionsFor("Conversations")}
        onSelect={menu.onAction}
      />
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset thread filters"
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onFilterModeChange("environment", "exclude");
            props.onEnvironmentChange([]);
            props.onFilterModeChange("project", "exclude");
            props.onProjectChange([]);
            props.onPinnedFilterChange("all");
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
