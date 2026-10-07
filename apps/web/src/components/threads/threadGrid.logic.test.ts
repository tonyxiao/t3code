import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  filterThreadGridRows,
  focusedThreadGridRowKeys,
  selectAllThreadGridRows,
  selectThreadGridRow,
  groupThreadGridRows,
  sortThreadGridRows,
  threadGridKey,
  threadGridState,
  type ThreadGridRow,
} from "./threadGrid.logic";

const NOW = "2026-10-07T12:00:00.000Z";
function thread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("one"),
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("project"),
    title: "Fix sidebar",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "fix/sidebar",
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}
function row(overrides: Partial<ThreadGridRow> = {}): ThreadGridRow {
  const shell = thread();
  return {
    key: threadGridKey(shell),
    thread: shell,
    title: shell.title,
    project: "T3 Code",
    projectKey: "local:project",
    environment: "Local",
    environmentKey: "local",
    provider: "Codex",
    model: "gpt-6",
    branch: "fix/sidebar",
    state: "Active",
    status: "Ready",
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}
const emptyFilters = {
  query: "",
  state: "",
  project: "",
  environment: "",
  provider: "",
  status: "",
};

describe("thread grid", () => {
  it("keeps matching thread and project ids in different environments separate", () => {
    const local = thread();
    const remote = thread({ environmentId: EnvironmentId.make("remote") });
    expect(threadGridKey(local)).not.toBe(threadGridKey(remote));
    const localRow = row();
    const remoteRow = row({
      key: threadGridKey(remote),
      thread: remote,
      projectKey: "remote:project",
      environmentKey: "remote",
    });
    expect(
      filterThreadGridRows([localRow, remoteRow], { ...emptyFilters, project: "remote:project" }),
    ).toEqual([remoteRow]);
    expect(Object.keys(groupThreadGridRows([localRow, remoteRow], "project"))).toEqual([
      "local:project",
      "remote:project",
    ]);
  });

  it("combines text terms with structured filters", () => {
    const wanted = row();
    const wrongStatus = row({ key: "other", status: "Working" });
    expect(
      filterThreadGridRows([wanted, wrongStatus], {
        ...emptyFilters,
        query: "SIDEBAR codex",
        status: "Ready",
        environment: "local",
        state: "Active",
      }),
    ).toEqual([wanted]);
    expect(filterThreadGridRows([wanted], { ...emptyFilters, query: "sidebar missing" })).toEqual(
      [],
    );
  });

  it("includes both approval and input requests in Needs you", () => {
    const approval = row({ key: "approval", status: "Needs approval" });
    const input = row({ key: "input", status: "Needs input" });
    expect(
      filterThreadGridRows([row(), approval, input], { ...emptyFilters, status: "attention" }),
    ).toEqual([approval, input]);
  });

  it("sorts by multiple columns and compares date instants across offsets", () => {
    const first = row({ key: "a", title: "Alpha", updated: "2026-10-07T14:00:00+03:00" });
    const second = row({ key: "b", title: "Beta", updated: "2026-10-07T12:00:00Z" });
    expect(
      sortThreadGridRows([first, second], [{ columnKey: "updated", direction: "DESC" }]),
    ).toEqual([second, first]);
    expect(
      sortThreadGridRows(
        [second, first],
        [
          { columnKey: "project", direction: "ASC" },
          { columnKey: "title", direction: "ASC" },
        ],
      ),
    ).toEqual([first, second]);
    expect(sortThreadGridRows([second, first], [])).toEqual([first, second]);
  });

  it("classifies archive and snooze ahead of settled and pinned, and wakes expired snoozes", () => {
    const snoozed = thread({
      snoozedAt: NOW,
      snoozedUntil: "2026-10-08T12:00:00Z",
      settledOverride: "settled",
      pinnedAt: NOW,
    });
    expect(threadGridState(snoozed, NOW)).toBe("Snoozed");
    expect(threadGridState({ ...snoozed, archivedAt: NOW }, NOW)).toBe("Archived");
    expect(threadGridState({ ...snoozed, snoozedUntil: "2026-10-06T12:00:00Z" }, NOW)).toBe(
      "Settled",
    );
    expect(threadGridState(thread({ pinnedAt: NOW }), NOW)).toBe("Pinned");
    expect(threadGridState(thread(), NOW)).toBe("Active");
  });

  it("handles provider names that match object prototype properties", () => {
    const unusual = row({ provider: "__proto__" });
    const groups = groupThreadGridRows([unusual], "provider");
    expect(Object.keys(groups)).toEqual(["__proto__"]);
    expect(groups.__proto__).toEqual([unusual]);
  });
});

describe("thread grid selection modes", () => {
  const a = row({ key: "a", projectKey: "local:a" });
  const b = row({ key: "b", projectKey: "local:a" });
  const c = row({ key: "c", projectKey: "remote:a" });
  const visible = [a, b, c];
  const input = {
    mode: "rows" as const,
    editing: false,
    rows: visible,
    focusedRow: a,
    groupBy: "project",
    previousGroup: null,
    selectedKeys: new Set<string>(),
  };

  it("selects the focused group first, expands on the second press, and stays expanded", () => {
    const first = selectAllThreadGridRows(input);
    expect(first.kind).toBe("rows");
    if (first.kind !== "rows") throw new Error("Expected rows");
    expect(first.keys).toEqual(new Set(["a", "b"]));
    expect(first.scope).toBe("group");
    const second = selectAllThreadGridRows({
      ...input,
      previousGroup: first.group,
      selectedKeys: first.keys,
    });
    if (second.kind !== "rows") throw new Error("Expected rows");
    expect(second.keys).toEqual(new Set(["a", "b", "c"]));
    expect(second.scope).toBe("view");
    expect(
      selectAllThreadGridRows({ ...input, previousGroup: second.group, selectedKeys: second.keys }),
    ).toEqual(second);
  });

  it("never selects rows in cell mode and leaves editor select-all native in either mode", () => {
    expect(selectAllThreadGridRows({ ...input, mode: "cells" })).toEqual({ kind: "cell" });
    expect(selectAllThreadGridRows({ ...input, editing: true })).toEqual({ kind: "native" });
    expect(selectAllThreadGridRows({ ...input, mode: "cells", editing: true })).toEqual({
      kind: "native",
    });
  });

  it("does not skip the first scope when that group's rows were manually selected", () => {
    const result = selectAllThreadGridRows({ ...input, selectedKeys: new Set(["a", "b"]) });
    expect(result).toMatchObject({ scope: "group", keys: new Set(["a", "b"]) });
  });

  it("resets escalation when focus moves to another group", () => {
    const result = selectAllThreadGridRows({
      ...input,
      focusedRow: c,
      previousGroup: "local:a",
      selectedKeys: new Set(["a", "b"]),
    });
    expect(result).toMatchObject({ scope: "group", keys: new Set(["c"]) });
  });

  it("supports collapsed group headers and never expands beyond the filtered input", () => {
    const hidden = row({ key: "hidden", projectKey: "local:a" });
    const focus = { id: "local:a", childRows: [a, b, hidden] };
    const result = selectAllThreadGridRows({ ...input, focusedRow: focus });
    expect(result).toMatchObject({ keys: new Set(["a", "b"]) });
    expect(focusedThreadGridRowKeys({ id: "local:a", childRows: [a, b] })).toEqual(["a", "b"]);
    expect(focusedThreadGridRowKeys(c)).toEqual(["c"]);
  });

  it("selects the whole filtered view immediately when ungrouped or focused on a header", () => {
    expect(selectAllThreadGridRows({ ...input, groupBy: undefined })).toMatchObject({
      scope: "view",
      keys: new Set(["a", "b", "c"]),
    });
    expect(selectAllThreadGridRows({ ...input, focusedRow: undefined })).toMatchObject({
      scope: "view",
      keys: new Set(["a", "b", "c"]),
    });
  });

  it("supports row toggle and range selection without treating cell focus as row selection", () => {
    const basic = {
      rowKey: "b",
      orderedKeys: ["a", "b", "c"],
      selectedKeys: new Set(["a"]),
      anchor: "a",
      toggle: false,
      range: false,
    };
    expect(selectThreadGridRow(basic)).toEqual(new Set(["b"]));
    expect(selectThreadGridRow({ ...basic, toggle: true })).toEqual(new Set(["a", "b"]));
    expect(selectThreadGridRow({ ...basic, rowKey: "a", toggle: true })).toEqual(new Set());
    expect(selectThreadGridRow({ ...basic, rowKey: "c", range: true })).toEqual(
      new Set(["a", "b", "c"]),
    );
  });
});
