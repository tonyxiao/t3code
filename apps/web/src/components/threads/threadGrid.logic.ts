import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { SortColumn } from "react-data-grid";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";

export const THREAD_STATES = ["Active", "Pinned", "Snoozed", "Settled", "Archived"] as const;
export type ThreadGridState = (typeof THREAD_STATES)[number];
export interface ThreadGridRow {
  key: string;
  thread: EnvironmentThreadShell;
  title: string;
  project: string;
  projectKey: string;
  environment: string;
  environmentKey: string;
  provider: string;
  model: string;
  branch: string;
  state: ThreadGridState;
  status: string;
  updated: string;
  created: string;
}

export function threadGridState(thread: EnvironmentThreadShell, now: string): ThreadGridState {
  if (thread.archivedAt !== null) return "Archived";
  if (effectiveSnoozed(thread, { now })) return "Snoozed";
  if (thread.settledOverride === "settled") return "Settled";
  if (thread.pinnedAt != null) return "Pinned";
  return "Active";
}

export function threadGridKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

export function threadGridStatus(thread: EnvironmentThreadShell): string {
  const status = resolveSidebarThreadStatus(thread);
  return {
    approval: "Needs approval",
    input: "Needs input",
    working: "Working",
    monitoring: "Monitoring",
    failed: "Failed",
    ready: "Ready",
  }[status];
}

export function filterThreadGridRows(
  rows: readonly ThreadGridRow[],
  filters: {
    query: string;
    state: string;
    project: string;
    environment: string;
    provider: string;
    status: string;
  },
): ThreadGridRow[] {
  const terms = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filters.state && row.state !== filters.state) return false;
    if (filters.project && row.projectKey !== filters.project) return false;
    if (filters.environment && row.environmentKey !== filters.environment) return false;
    if (filters.provider && row.provider !== filters.provider) return false;
    if (filters.status === "attention") {
      if (row.status !== "Needs approval" && row.status !== "Needs input") return false;
    } else if (filters.status && row.status !== filters.status) return false;
    const text = [row.title, row.project, row.environment, row.provider, row.model, row.branch]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function sortThreadGridRows(
  rows: readonly ThreadGridRow[],
  columns: readonly SortColumn[],
): ThreadGridRow[] {
  const sortable = (row: ThreadGridRow, key: string) => {
    switch (key) {
      case "title":
        return row.title;
      case "project":
        return row.project;
      case "environment":
        return row.environment;
      case "provider":
        return row.provider;
      case "model":
        return row.model;
      case "branch":
        return row.branch;
      case "state":
        return row.state;
      case "status":
        return row.status;
      case "updated":
        return row.updated;
      case "created":
        return row.created;
      default:
        return "";
    }
  };
  return [...rows].sort((a, b) => {
    for (const column of columns) {
      const comparison =
        column.columnKey === "updated" || column.columnKey === "created"
          ? Date.parse(sortable(a, column.columnKey)) - Date.parse(sortable(b, column.columnKey))
          : sortable(a, column.columnKey).localeCompare(sortable(b, column.columnKey), undefined, {
              numeric: true,
            });
      if (comparison !== 0) return column.direction === "ASC" ? comparison : -comparison;
    }
    return a.key.localeCompare(b.key);
  });
}

export function groupThreadGridRows(
  rows: readonly ThreadGridRow[],
  key: string,
): Record<string, readonly ThreadGridRow[]> {
  // Object.fromEntries safely handles labels such as "__proto__".
  const groups = new Map<string, ThreadGridRow[]>();
  for (const row of rows) {
    const label = threadGridGroupKey(row, key);
    const group = groups.get(label);
    if (group) group.push(row);
    else groups.set(label, [row]);
  }
  return Object.fromEntries(groups);
}

export type ThreadGridInteractionMode = "cells" | "rows";
export type ThreadGridFocusedRow =
  | ThreadGridRow
  | { id: string; childRows: readonly ThreadGridRow[] };

export function threadGridGroupKey(row: ThreadGridRow, groupBy: string): string {
  return groupBy === "project"
    ? row.projectKey
    : groupBy === "environment"
      ? row.environmentKey
      : groupBy === "provider"
        ? row.provider
        : row.state;
}

/** Select-all expands only after an explicit first press in the same group. */
export function selectAllThreadGridRows(input: {
  mode: ThreadGridInteractionMode;
  editing: boolean;
  rows: readonly ThreadGridRow[];
  focusedRow: ThreadGridFocusedRow | undefined;
  groupBy: string | undefined;
  previousGroup: string | null;
  selectedKeys: ReadonlySet<string>;
}) {
  if (input.editing) return { kind: "native" as const };
  if (input.mode === "cells") return { kind: "cell" as const };
  const focused = input.focusedRow;
  const group =
    input.groupBy && focused
      ? "childRows" in focused
        ? focused.id
        : threadGridGroupKey(focused, input.groupBy)
      : null;
  const groupRows =
    group === null
      ? input.rows
      : input.rows.filter((row) => threadGridGroupKey(row, input.groupBy ?? "state") === group);
  const expand =
    group !== null &&
    input.previousGroup === group &&
    groupRows.every((row) => input.selectedKeys.has(row.key));
  return {
    kind: "rows" as const,
    group,
    scope: expand || group === null ? ("view" as const) : ("group" as const),
    keys: new Set((expand ? input.rows : groupRows).map((row) => row.key)),
  };
}

export function selectThreadGridRow(input: {
  rowKey: string;
  orderedKeys: readonly string[];
  selectedKeys: ReadonlySet<string>;
  anchor: string | null;
  toggle: boolean;
  range: boolean;
}): ReadonlySet<string> {
  const target = input.orderedKeys.indexOf(input.rowKey);
  const anchor = input.anchor === null ? -1 : input.orderedKeys.indexOf(input.anchor);
  if (input.range && target !== -1 && anchor !== -1) {
    const keys = input.orderedKeys.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
    return new Set([...input.selectedKeys, ...keys]);
  }
  if (!input.toggle) return new Set([input.rowKey]);
  const next = new Set(input.selectedKeys);
  if (next.has(input.rowKey)) next.delete(input.rowKey);
  else next.add(input.rowKey);
  return next;
}

export function focusedThreadGridRowKeys(row: ThreadGridFocusedRow): readonly string[] {
  return "childRows" in row ? row.childRows.map((child) => child.key) : [row.key];
}
