import { useMemo } from "react";

import { useUiStateStore } from "../uiStateStore";

/** Catalog readiness can precede local registration and relay discovery; keep saved scopes. */
export function useSidebarEnvironmentScope() {
  const filterModes = useUiStateStore((store) => store.sidebarFilterModes);
  const setFilterMode = useUiStateStore((store) => store.setSidebarFilterMode);
  const environmentScopeIds = useUiStateStore((store) => store.sidebarEnvironmentScopeIds);
  const setEnvironmentScopeIds = useUiStateStore((store) => store.setSidebarEnvironmentScopeIds);
  const scopedEnvironmentIds = useMemo(
    () =>
      environmentScopeIds.length === 0 && filterModes.environment === "exclude"
        ? null
        : new Set(environmentScopeIds),
    [environmentScopeIds, filterModes.environment],
  );
  return {
    filterModes,
    setFilterMode,
    environmentScopeIds,
    setEnvironmentScopeIds,
    scopedEnvironmentIds,
  };
}
