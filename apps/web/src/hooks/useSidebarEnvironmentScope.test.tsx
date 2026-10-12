// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { parsePersistedState, PERSISTED_STATE_KEY, useUiStateStore } from "../uiStateStore";
import { useSidebarEnvironmentScope } from "./useSidebarEnvironmentScope";

const catalog = vi.hoisted(() => ({
  isReady: true,
  environments: [{ environmentId: "local" }],
}));
vi.mock("../state/environments", () => ({ useEnvironments: () => catalog }));

let renderer: ReactTestRenderer | undefined;
let scope: ReturnType<typeof useSidebarEnvironmentScope>;
const initialState = useUiStateStore.getState();

function Probe() {
  const value = useSidebarEnvironmentScope();
  useLayoutEffect(() => {
    scope = value;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  catalog.environments = [{ environmentId: "local" }];
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  useUiStateStore.setState(initialState, true);
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each([
  { mode: "include", target: "local" },
  { mode: "exclude", target: "local" },
  { mode: "include", target: "remote-a" },
  { mode: "exclude", target: "remote-a" },
] as const)(
  "keeps saved $mode filters for $target through partial startup catalogs and rediscovery",
  ({ mode, target }) => {
    catalog.environments = [{ environmentId: target === "local" ? "remote-a" : "local" }];
    const saved = {
      sidebarFilterSelectionVersion: 1,
      sidebarEnvironmentScopeIds: [target, "remote-b"],
      sidebarFilterModes: {
        environment: mode,
        project: "exclude" as const,
        pinned: "include" as const,
      },
    };
    localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(saved));
    useUiStateStore.setState(parsePersistedState(saved));
    act(() => {
      renderer = create(<Probe />);
    });
    expect(scope.environmentScopeIds).toEqual([target, "remote-b"]);
    expect(scope.filterModes.environment).toBe(mode);

    act(() => {
      catalog.environments = [
        { environmentId: "local" },
        { environmentId: "remote-a" },
        { environmentId: "remote-b" },
      ];
      renderer!.update(<Probe />);
    });
    expect([...scope.scopedEnvironmentIds!]).toEqual([target, "remote-b"]);

    // An unrelated UI update must not write a startup reset over the saved filter.
    act(() => {
      useUiStateStore.getState().setSidebarThreadSortOrder("updated_at");
      vi.runAllTimers();
    });
    const restored = parsePersistedState(JSON.parse(localStorage.getItem(PERSISTED_STATE_KEY)!));
    expect(restored.sidebarEnvironmentScopeIds).toEqual([target, "remote-b"]);
    expect(restored.sidebarFilterModes.environment).toBe(mode);
  },
);
