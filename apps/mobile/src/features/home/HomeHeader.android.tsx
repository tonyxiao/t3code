import { buildHomeListFilterNativeMenu } from "./home-list-filter-menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { MaterialThreadListToolbar } from "./MaterialThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

export function HomeHeader(props: HomeHeaderProps) {
  const hasCustomListOptions =
    props.selectedEnvironmentIds.length > 0 ||
    props.selectedProjectKeys.length > 0 ||
    props.filterModes.environment === "include" ||
    props.filterModes.project === "include" ||
    props.pinnedFilter !== "all";
  const menu = useMemo(() => buildHomeListFilterNativeMenu(props), [props]);
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      menu.onAction(event.nativeEvent.event);
    },
    [menu],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <MaterialThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menu.actions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
