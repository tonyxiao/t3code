import { describe, expect, it } from "vite-plus/test";
import {
  matchesSidebarFilter,
  sanitizeSidebarFilterModes,
  sidebarFilterValueChecked,
  resolveSidebarFilterCheckboxSelection,
  toggleSidebarFilterValues,
  matchesSidebarPinFilter,
  toggleSidebarPinFilter,
} from "./sidebarFilters";

describe("sidebar checkbox selection", () => {
  const available = ["a", "b"];
  it("checks every row in All and stores exclusions when a row is unchecked", () => {
    expect(available.map((key) => sidebarFilterValueChecked(key, [], "exclude"))).toEqual([
      true,
      true,
    ]);
    const excluded = resolveSidebarFilterCheckboxSelection([], "exclude", available, ["all", "b"]);
    expect(excluded).toEqual({ keys: ["a"], mode: "exclude" });
    expect(
      available.map((key) => sidebarFilterValueChecked(key, excluded.keys, excluded.mode)),
    ).toEqual([false, true]);
    expect(
      resolveSidebarFilterCheckboxSelection(excluded.keys, excluded.mode, available, ["a", "b"]),
    ).toEqual({ keys: [], mode: "exclude" });
  });
  it("lets All select and deselect every row, including from a partial selection", () => {
    expect(resolveSidebarFilterCheckboxSelection([], "exclude", available, ["a", "b"])).toEqual({
      keys: [],
      mode: "include",
    });
    expect(resolveSidebarFilterCheckboxSelection([], "include", available, ["all"])).toEqual({
      keys: [],
      mode: "exclude",
    });
    expect(
      resolveSidebarFilterCheckboxSelection(["a"], "include", available, ["a", "all"]),
    ).toEqual({ keys: [], mode: "exclude" });
  });
  it("Only checks that entry and deselecting the last entry yields no matches", () => {
    expect(available.map((key) => sidebarFilterValueChecked(key, ["a"], "include"))).toEqual([
      true,
      false,
    ]);
    expect(resolveSidebarFilterCheckboxSelection(["a"], "include", available, [])).toEqual({
      keys: [],
      mode: "include",
    });
    expect(matchesSidebarFilter(false, "include")).toBe(false);
    expect(resolveSidebarFilterCheckboxSelection(["a"], "include", available, ["a", "b"])).toEqual({
      keys: [],
      mode: "exclude",
    });
  });
  it("preserves exclusions outside a temporarily incomplete catalog", () => {
    expect(
      resolveSidebarFilterCheckboxSelection(["offline"], "exclude", available, ["all", "b"]),
    ).toEqual({ keys: ["offline", "a"], mode: "exclude" });
  });
  it("toggles an entire project's environment group with the same checked meaning", () => {
    expect(toggleSidebarFilterValues([], "exclude", available)).toEqual(available);
    expect(toggleSidebarFilterValues(available, "exclude", available)).toEqual([]);
    expect(toggleSidebarFilterValues(["a"], "include", available)).toEqual(available);
  });
  it("keeps legacy inclusion semantics when persisted modes are missing", () => {
    expect(sanitizeSidebarFilterModes(null)).toEqual({
      environment: "include",
      project: "include",
      pinned: "include",
    });
    expect(
      sanitizeSidebarFilterModes({ environment: "exclude", project: "bad", pinned: true }),
    ).toEqual({ environment: "exclude", project: "include", pinned: "include" });
  });
  it("checks both conversation categories in All and supports Only and None", () => {
    expect(matchesSidebarPinFilter(true, "all")).toBe(true);
    expect(matchesSidebarPinFilter(false, "all")).toBe(true);
    expect(toggleSidebarPinFilter("all", "pinned")).toBe("unpinned");
    expect(toggleSidebarPinFilter("unpinned", "unpinned")).toBe("none");
    expect(matchesSidebarPinFilter(true, "none")).toBe(false);
    expect(matchesSidebarPinFilter(false, "pinned")).toBe(false);
    expect(toggleSidebarPinFilter("pinned", "unpinned")).toBe("all");
  });
});
