import { DEFAULT_SIDEBAR_FILTER_MODES } from "@t3tools/client-runtime/state/sidebar-filters";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { buildHomeListFilterMenu, type HomeListFilterMenuItem } from "./home-list-filter-menu";

function setup(overrides: Partial<Parameters<typeof buildHomeListFilterMenu>[0]> = {}) {
  return {
    environments: [
      { environmentId: EnvironmentId.make("env-a"), label: "Laptop" },
      { environmentId: EnvironmentId.make("env-b"), label: "Server" },
    ],
    projects: [
      { key: "site", label: "Website" },
      { key: "api", label: "API" },
    ],
    selectedEnvironmentIds: [],
    selectedProjectKeys: [],
    pinnedFilter: "all" as const,
    filterModes: DEFAULT_SIDEBAR_FILTER_MODES,
    onEnvironmentChange: vi.fn(),
    onProjectChange: vi.fn(),
    onPinnedFilterChange: vi.fn(),
    onFilterModeChange: vi.fn(),
    ...overrides,
  };
}
function submenu(items: readonly HomeListFilterMenuItem[], title: string) {
  const item = items.find((item) => item.title === title);
  if (item?.type !== "submenu") throw new Error(`Missing ${title} submenu`);
  return item;
}
function action(items: readonly HomeListFilterMenuItem[], title: string) {
  const item = items.find((item) => item.title === title);
  if (item?.type !== "action") throw new Error(`Missing ${title} action`);
  return item;
}

describe("native sidebar checkbox filters", () => {
  it("checks All and every entry, and unchecking multiple entries preserves earlier exclusions", () => {
    const props = setup();
    const projects = submenu(buildHomeListFilterMenu(props).items, "Project");
    expect(action(projects.items, "All projects").state).toBe("on");
    expect(action(projects.items, "Website").state).toBe("on");
    expect(action(projects.items, "API").state).toBe("on");
    action(projects.items, "Website").onPress();
    expect(props.onProjectChange).toHaveBeenLastCalledWith(["site"]);
    const excluded = submenu(
      buildHomeListFilterMenu({ ...props, selectedProjectKeys: ["site"] }).items,
      "Project",
    );
    expect(action(excluded.items, "Website").state).toBe("off");
    expect(action(excluded.items, "API").state).toBe("on");
    action(excluded.items, "API").onPress();
    expect(props.onProjectChange).toHaveBeenLastCalledWith(["site", "api"]);
  });
  it("Only selects one project and All resets both mode and selection", () => {
    const props = setup();
    const projects = submenu(buildHomeListFilterMenu(props).items, "Project");
    action(submenu(projects.items, "Only…").items, "Website").onPress();
    expect(props.onFilterModeChange).toHaveBeenLastCalledWith("project", "include");
    expect(props.onProjectChange).toHaveBeenLastCalledWith(["site"]);
    const only = submenu(
      buildHomeListFilterMenu({
        ...props,
        selectedProjectKeys: ["site"],
        filterModes: { ...props.filterModes, project: "include" },
      }).items,
      "Project",
    );
    expect(action(only.items, "Website").state).toBe("on");
    expect(action(only.items, "API").state).toBe("off");
    action(only.items, "All projects").onPress();
    expect(props.onFilterModeChange).toHaveBeenLastCalledWith("project", "exclude");
    expect(props.onProjectChange).toHaveBeenLastCalledWith([]);
  });
  it("checks both pin categories by default and supports unchecking and Only", () => {
    const props = setup();
    const pins = submenu(buildHomeListFilterMenu(props).items, "Conversations");
    expect(action(pins.items, "Pinned").state).toBe("on");
    expect(action(pins.items, "Unpinned").state).toBe("on");
    action(pins.items, "Pinned").onPress();
    expect(props.onPinnedFilterChange).toHaveBeenLastCalledWith("unpinned");
    action(submenu(pins.items, "Only…").items, "Pinned").onPress();
    expect(props.onPinnedFilterChange).toHaveBeenLastCalledWith("pinned");
  });
});
