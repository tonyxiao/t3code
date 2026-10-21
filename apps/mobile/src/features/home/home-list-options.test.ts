import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const saved = vi.hoisted(() => [] as unknown[]);
vi.mock("../../state/preferences", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    updateMobilePreferencesAtom: Atom.writable(
      () => null,
      (_ctx, patch: unknown) => {
        saved.push(patch);
      },
    ),
  };
});

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { HomeListOptionsProvider, useHomeListOptions } from "./home-list-options";

describe("home list options across layout changes", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const availableEnvironmentIds = new Set([environmentId]);
  let root: Root;
  let latest: ReturnType<typeof useHomeListOptions>;

  function ThreadList() {
    const state = useHomeListOptions(availableEnvironmentIds);
    useLayoutEffect(() => {
      latest = state;
    });
    return null;
  }

  const registry = AtomRegistry.make();

  async function showLayout(layout: "compact" | "sidebar", savedFilters?: ThreadListFilters) {
    await act(() => {
      root.render(
        createElement(
          RegistryContext,
          { value: registry },
          createElement(
            HomeListOptionsProvider,
            { projectGroupingMode: "repository", savedFilters },
            createElement(ThreadList, { key: layout }),
          ),
        ),
      );
    });
  }

  beforeEach(() => {
    const document = {
      nodeType: 9,
      addEventListener() {},
      removeEventListener() {},
    };
    const container = {
      nodeType: 1,
      tagName: "DIV",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      ownerDocument: document,
      addEventListener() {},
      removeEventListener() {},
    };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(container as unknown as HTMLElement);
    saved.length = 0;
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it.each([
    ["compact", "sidebar"],
    ["sidebar", "compact"],
  ] as const)(
    "retains filters through repeated %s → %s round trips and keeps clears",
    async (initialLayout, otherLayout) => {
      await showLayout(initialLayout);

      for (const [selectedEnvironmentIds, selectedProjectKeys] of [
        [[environmentId], ["repository:one"]],
        [[environmentId], ["repository:two"]],
        [[environmentId], []],
        [[], []],
        [[], ["repository:one"]],
      ] as const) {
        await act(() => {
          latest.setSelectedEnvironmentIds(selectedEnvironmentIds);
          latest.setSelectedProjectKeys(selectedProjectKeys);
        });
        for (let cycle = 0; cycle < 3; cycle += 1) {
          for (const layout of [otherLayout, initialLayout]) {
            await showLayout(layout);
            expect(latest.options).toMatchObject({
              selectedEnvironmentIds,
              selectedProjectKeys,
              projectGroupingMode: "repository",
            });
          }
        }
        await showLayout(otherLayout);
      }
    },
  );

  it("restores saved filters on launch and saves only real changes", async () => {
    await showLayout("compact", {
      environmentIds: [environmentId],
      projectKeys: ["repository:one"],
      environmentMode: "include",
      projectMode: "include",
      pinnedFilter: "all",
    });
    expect(latest.options).toMatchObject({
      selectedEnvironmentIds: [environmentId],
      selectedProjectKeys: ["repository:one"],
    });
    expect(saved).toEqual([]);

    await act(() => latest.setSelectedProjectKeys([]));
    expect(saved).toEqual([
      {
        threadListFilters: {
          environmentIds: [environmentId],
          projectKeys: [],
          environmentMode: "include",
          projectMode: "include",
          pinnedFilter: "all",
        },
      },
    ]);
  });

  it("migrates a saved single scope without losing its selection", async () => {
    await showLayout("compact", { environmentId, projectKey: "repository:one" });
    expect(latest.options).toMatchObject({
      selectedEnvironmentIds: [environmentId],
      selectedProjectKeys: ["repository:one"],
      filterModes: { environment: "include", project: "include" },
    });
    expect(saved).toEqual([
      {
        threadListFilters: {
          environmentIds: [environmentId],
          projectKeys: ["repository:one"],
          environmentMode: "include",
          projectMode: "include",
          pinnedFilter: "all",
        },
      },
    ]);
  });
});
