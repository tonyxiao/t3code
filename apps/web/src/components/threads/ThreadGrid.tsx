import "react-data-grid/lib/styles.css";
import "./threadGrid.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  DataGrid,
  TreeDataGrid,
  SelectColumn,
  SELECT_COLUMN_KEY,
  renderTextEditor,
  renderToggleGroup,
  type Column,
  type SortColumn,
  type RenderGroupCellProps,
  type CellKeyboardEvent,
  type CellKeyDownArgs,
  type CellMouseArgs,
  type CellMouseEvent,
  type PositionChangeArgs,
  type DataGridHandle,
} from "react-data-grid";
import {
  ArchiveIcon,
  AlarmClockIcon,
  ArrowUpRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  settlePromise,
} from "@t3tools/client-runtime/state/runtime";
import { useProjects, useThreadShells, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useAtomCommand } from "../../state/use-atom-command";
import { threadEnvironment } from "../../state/threads";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { deriveProviderEntriesByEnvironment } from "../../providerInstances";
import { buildThreadRouteParams } from "../../threadRoutes";
import { readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { isElectron } from "../../env";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import { SidebarInset, SidebarTrigger, useSidebar } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { resolveSnoozePresets } from "../Sidebar.snooze";
import {
  THREAD_STATES,
  filterThreadGridRows,
  sortThreadGridRows,
  groupThreadGridRows,
  threadGridKey,
  threadGridState,
  threadGridStatus,
  focusedThreadGridRowKeys,
  selectAllThreadGridRows,
  selectThreadGridRow,
  type ThreadGridInteractionMode,
  type ThreadGridRow,
} from "./threadGrid.logic";

const EMPTY_FILTERS = {
  query: "",
  state: "",
  project: "",
  environment: "",
  provider: "",
  status: "",
};
const GROUP_OPTIONS = ["state", "project", "environment", "provider"];
const rowKeyGetter = (row: ThreadGridRow) => row.key;
const DEFAULT_COLUMNS = { resizable: true, sortable: true, minWidth: 120 };

const renderGroupCell = (props: RenderGroupCellProps<ThreadGridRow>) => {
  const first = props.childRows[0];
  const label =
    props.column.key === "project" && first
      ? `${first.project} · ${first.environment}`
      : props.column.key === "environment" && first
        ? first.environment
        : props.groupKey;
  return renderToggleGroup({ ...props, groupKey: `${String(label)} (${props.childRows.length})` });
};

function GridFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 max-w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThreadGrid() {
  const liveThreads = useThreadShells();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.serverConfig !== null)
        .map((environment) => environment.environmentId),
    [environments],
  );
  const archives = useArchivedThreadSnapshots(environmentIds);
  const actions = useThreadActions();
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const confirmArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const minute = useNowMinute();
  const now = `${minute}:00.000Z`;
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([
    { columnKey: "updated", direction: "DESC" },
  ]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<unknown>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [interactionMode, setInteractionMode] = useState<ThreadGridInteractionMode>("cells");
  const selectAllGroup = useRef<string | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const gridRef = useRef<DataGridHandle>(null);
  const focusedPosition = useRef({ rowIdx: 0, idx: 1 });
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const pendingRenames = useRef(new Set<string>());

  const rows = useMemo(() => {
    const projectNames = new Map(
      projects.map((project) => [`${project.environmentId}:${project.id}`, project.title]),
    );
    const environmentNames = new Map(
      environments.map((environment) => [environment.environmentId, environment.label]),
    );
    const providerEntries = deriveProviderEntriesByEnvironment(
      [...serverConfigs].map(([id, config]) => [id, config.providers] as const),
    );
    const threads = new Map<string, ThreadGridRow["thread"]>();
    for (const { environmentId, snapshot } of archives.snapshots) {
      for (const project of snapshot.projects) {
        if (!projectNames.has(`${environmentId}:${project.id}`))
          projectNames.set(`${environmentId}:${project.id}`, project.title);
      }
      for (const thread of snapshot.threads) {
        const scoped = { ...thread, environmentId };
        threads.set(threadGridKey(scoped), scoped);
      }
    }
    // The live shell wins when an archived snapshot still contains a just-restored thread.
    for (const thread of liveThreads) threads.set(threadGridKey(thread), thread);
    return [...threads.values()].map((thread): ThreadGridRow => ({
      key: threadGridKey(thread),
      thread,
      title: thread.title,
      project: projectNames.get(`${thread.environmentId}:${thread.projectId}`) ?? "Unknown project",
      projectKey: `${thread.environmentId}:${thread.projectId}`,
      environment: environmentNames.get(thread.environmentId) ?? "Unknown environment",
      environmentKey: thread.environmentId,
      provider:
        providerEntries.get(thread.environmentId)?.get(thread.modelSelection.instanceId)
          ?.displayName ??
        thread.session?.providerName ??
        thread.modelSelection.instanceId,
      model: thread.modelSelection.model,
      branch: thread.branch ?? "",
      state: threadGridState(thread, now),
      status: thread.archivedAt !== null ? "Archived" : threadGridStatus(thread),
      updated: thread.updatedAt,
      created: thread.createdAt,
    }));
  }, [archives.snapshots, environments, liveThreads, now, projects, serverConfigs]);
  const visibleRows = useMemo(
    () => sortThreadGridRows(filterThreadGridRows(rows, filters), sortColumns),
    [filters, rows, sortColumns],
  );
  const selectedRows = useMemo(
    () => visibleRows.filter((row) => selectedKeys.has(row.key)),
    [selectedKeys, visibleRows],
  );
  // The actionable selection always intersects the current filter. Hidden rows never act.
  const visibleSelection = useMemo(
    () => new Set(selectedRows.map((row) => row.key)),
    [selectedRows],
  );
  const orderedRowKeys = useMemo(() => {
    const ordered = groupBy[0]
      ? Object.values(groupThreadGridRows(visibleRows, groupBy[0])).flat()
      : visibleRows;
    return ordered.map((row) => row.key);
  }, [groupBy, visibleRows]);
  const changeInteractionMode = (mode: ThreadGridInteractionMode) => {
    setInteractionMode(mode);
    selectAllGroup.current = null;
    if (mode === "cells") setSelectedKeys(new Set());
    gridRef.current?.setActivePosition(focusedPosition.current, { shouldFocus: true });
  };
  const handleRowSelectionChange = (keys: Set<string>) => {
    selectAllGroup.current = null;
    setInteractionMode("rows");
    setSelectedKeys(keys);
  };
  const handleCellClick = (args: CellMouseArgs<ThreadGridRow>, event: CellMouseEvent) => {
    selectAllGroup.current = null;
    if (args.column.key === SELECT_COLUMN_KEY) {
      setInteractionMode("rows");
      selectionAnchor.current = args.row.key;
      return;
    }
    if (interactionMode !== "rows" || args.column.key === "open") return;
    const toggle = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
    setSelectedKeys(
      selectThreadGridRow({
        rowKey: args.row.key,
        orderedKeys: orderedRowKeys,
        selectedKeys: visibleSelection,
        anchor: selectionAnchor.current,
        toggle,
        range: event.shiftKey,
      }),
    );
    if (!event.shiftKey) selectionAnchor.current = args.row.key;
  };
  const handleCellKeyDown = (args: CellKeyDownArgs<ThreadGridRow>, event: CellKeyboardEvent) => {
    // Editors own their text shortcuts, including select-all and Escape.
    if (args.mode === "EDIT" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.preventGridDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const result = selectAllThreadGridRows({
        mode: interactionMode,
        editing: false,
        rows: visibleRows,
        focusedRow: args.row,
        groupBy: groupBy[0],
        previousGroup: selectAllGroup.current,
        selectedKeys: visibleSelection,
      });
      if (result.kind === "rows") {
        setSelectedKeys(result.keys);
        selectAllGroup.current = result.group;
      }
      return;
    }
    if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) return;
    selectAllGroup.current = null;
    if (event.key === "Escape") {
      event.preventDefault();
      event.preventGridDefault();
      event.stopPropagation();
      setSelectedKeys(new Set());
      setInteractionMode("cells");
      return;
    }
    if (event.key === " " && (event.shiftKey || interactionMode === "rows")) {
      setInteractionMode("rows");
      event.preventDefault();
      event.preventGridDefault();
      if (args.row) {
        const keys = focusedThreadGridRowKeys(args.row);
        const next = new Set(visibleSelection);
        const remove = keys.every((key) => next.has(key));
        for (const key of keys) {
          if (remove) next.delete(key);
          else next.add(key);
        }
        setSelectedKeys(next);
        if (keys.length === 1) selectionAnchor.current = keys[0] ?? null;
      }
      return;
    }
    if (
      (event.key === "Enter" || event.key === "F2") &&
      args.column?.key === "title" &&
      args.row &&
      "thread" in args.row &&
      args.row.state !== "Archived"
    ) {
      setInteractionMode("cells");
      setSelectedKeys(new Set());
      event.preventDefault();
      event.preventGridDefault();
      args.setActivePosition({ rowIdx: args.rowIdx, idx: args.column.idx }, { enableEditor: true });
      return;
    }
    if (interactionMode === "rows" && !mod && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      event.preventGridDefault();
    }
  };
  const setFilter = (key: keyof typeof filters, value: string) => {
    selectAllGroup.current = null;
    selectionAnchor.current = null;
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedKeys(new Set());
  };
  const options = useCallback(
    (key: "project" | "environment" | "provider" | "status") => {
      const values = new Map<string, string>();
      for (const row of rows)
        values.set(
          key === "project"
            ? row.projectKey
            : key === "environment"
              ? row.environmentKey
              : row[key],
          row[key],
        );
      return [...values]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    [rows],
  );
  const hasSelection = selectedRows.length > 0;
  const allLive = hasSelection && selectedRows.every((row) => row.state !== "Archived");
  const canArchive =
    allLive &&
    selectedRows.every(
      ({ thread }) =>
        !(thread.session?.status === "running" && thread.session.activeTurnId != null),
    );
  const canRestore = hasSelection && selectedRows.every((row) => row.state === "Archived");
  const canSnoozeSelected =
    allLive &&
    selectedRows.every(
      ({ thread }) =>
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
        canSnooze(thread, { now }),
    );
  const canWake =
    allLive &&
    selectedRows.every(
      (row) =>
        row.state === "Snoozed" &&
        serverConfigs.get(row.thread.environmentId)?.environment.capabilities.threadSnooze === true,
    );
  const canSettle =
    allLive &&
    selectedRows.every(
      (row) =>
        serverConfigs.get(row.thread.environmentId)?.environment.capabilities.threadSettlement ===
        true,
    );
  const canPin =
    allLive &&
    selectedRows.every(
      (row) =>
        serverConfigs.get(row.thread.environmentId)?.environment.capabilities.threadPinning ===
        true,
    );

  const runAction = async (
    action: "archive" | "restore" | "snooze" | "wake" | "settle" | "reopen" | "pin" | "unpin",
    until?: string,
  ) => {
    if (actionPending.current || selectedRows.length === 0) return;
    actionPending.current = true;
    setBusy(true);
    try {
      if (action === "archive" && confirmArchive) {
        const api = readLocalApi();
        if (!api) return;
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            `Archive ${selectedRows.length} thread${selectedRows.length === 1 ? "" : "s"}?`,
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      let failed = 0;
      let firstError = "";
      for (const row of selectedRows) {
        const ref = scopeThreadRef(row.thread.environmentId, row.thread.id);
        const result =
          action === "archive"
            ? await actions.archiveThread(ref)
            : action === "restore"
              ? await actions.unarchiveThread(ref)
              : action === "snooze" && until
                ? await actions.snoozeThread(ref, until)
                : action === "wake"
                  ? await actions.unsnoozeThread(ref)
                  : action === "settle"
                    ? await actions.settleThread(ref)
                    : action === "reopen"
                      ? await actions.unsettleThread(ref)
                      : action === "pin"
                        ? await actions.pinThread(ref)
                        : action === "unpin"
                          ? await actions.unpinThread(ref)
                          : null;
        if (!result) continue;
        if (result._tag === "Success") {
          setSelectedKeys((current) => {
            const next = new Set(current);
            next.delete(row.key);
            return next;
          });
        } else if (!isAtomCommandInterrupted(result)) {
          failed++;
          const error = squashAtomCommandFailure(result);
          if (!firstError)
            firstError = error instanceof Error ? error.message : "An error occurred.";
        }
      }
      if (failed > 0)
        toastManager.add({
          type: "error",
          title: `${failed} thread${failed === 1 ? "" : "s"} could not be updated`,
          description: firstError,
        });
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };

  const rename = useCallback(
    async (row: ThreadGridRow) => {
      const title = row.title.trim();
      if (!title) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (title === row.thread.title || pendingRenames.current.has(row.key)) return;
      pendingRenames.current.add(row.key);
      try {
        const result = await updateMetadata({
          environmentId: row.thread.environmentId,
          input: { threadId: row.thread.id, title },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      } finally {
        pendingRenames.current.delete(row.key);
      }
    },
    [updateMetadata],
  );

  const columns = useMemo<readonly Column<ThreadGridRow>[]>(
    () => [
      SelectColumn,
      {
        key: "title",
        name: "Thread",
        width: 360,
        minWidth: 220,
        frozen: true,
        editable: (row) => row.state !== "Archived",
        renderEditCell: renderTextEditor,
      },
      { key: "state", name: "State", width: 125, renderGroupCell },
      { key: "status", name: "Agent status", width: 145 },
      { key: "project", name: "Project", width: 180, renderGroupCell },
      { key: "environment", name: "Environment", width: 160, renderGroupCell },
      { key: "provider", name: "Provider", width: 130, renderGroupCell },
      { key: "model", name: "Model", width: 190 },
      { key: "branch", name: "Branch", width: 190 },
      {
        key: "updated",
        name: "Last activity",
        width: 185,
        renderCell: ({ row }) => new Date(row.updated).toLocaleString(),
      },
      {
        key: "created",
        name: "Created",
        width: 185,
        renderCell: ({ row }) => new Date(row.created).toLocaleString(),
      },
      {
        key: "open",
        name: "",
        width: 65,
        minWidth: 65,
        sortable: false,
        resizable: false,
        renderCell: ({ row }) =>
          row.state === "Archived" ? null : (
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(
                scopeThreadRef(row.thread.environmentId, row.thread.id),
              )}
              aria-label={`Open ${row.title}`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowUpRightIcon className="size-4" />
            </Link>
          ),
      },
    ],
    [],
  );
  const visibleColumns = useMemo(
    () =>
      columns.filter((column) => !hiddenColumns.has(column.key) || groupBy.includes(column.key)),
    [columns, hiddenColumns, groupBy],
  );
  const gridProps = {
    ref: gridRef,
    columns: visibleColumns,
    rows: visibleRows,
    rowKeyGetter,
    defaultColumnOptions: DEFAULT_COLUMNS,
    sortColumns,
    onSortColumnsChange: (columns: SortColumn[]) => {
      selectAllGroup.current = null;
      setSortColumns(columns);
    },
    selectedRows: visibleSelection,
    onSelectedRowsChange: handleRowSelectionChange,
    onCellClick: handleCellClick,
    onCellDoubleClick: (args: CellMouseArgs<ThreadGridRow>, event: CellMouseEvent) => {
      if (args.column.key !== "title" || args.row.state === "Archived") {
        event.preventGridDefault();
        return;
      }
      setInteractionMode("cells");
      setSelectedKeys(new Set());
      selectAllGroup.current = null;
    },
    onActivePositionChange: (args: PositionChangeArgs<ThreadGridRow>) => {
      selectAllGroup.current = null;
      focusedPosition.current = { rowIdx: args.rowIdx, idx: args.column?.idx ?? -1 };
    },
    onRowsChange: (next: ThreadGridRow[], { indexes }: { indexes: number[] }) => {
      for (const index of indexes) {
        const row = next[index];
        if (row) void rename(row);
      }
    },
    rowHeight: 38,
    headerRowHeight: 38,
    renderers: {
      noRowsFallback: (
        <div className="col-span-full px-4 py-12 text-center text-sm text-muted-foreground">
          No threads match these filters.
        </div>
      ),
    },
    className: "h-full border-0 text-xs",
    "data-testid": "thread-management-grid",
    "aria-label": "Threads",
    onCellKeyDown: handleCellKeyDown,
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Threads</h1>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarOpen ? "Expand thread grid" : "Show sidebar"}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <Maximize2Icon /> : <Minimize2Icon />}
          </Button>
        </div>
      </WorkspacePageHeader>
      <div
        className="flex items-center gap-1 border-b border-border px-4 py-2"
        aria-label="Thread views"
      >
        {[
          { label: "All threads", state: "", status: "" },
          { label: "Active", state: "Active", status: "" },
          { label: "Needs you", state: "", status: "attention" },
          { label: "Snoozed", state: "Snoozed", status: "" },
          { label: "Archived", state: "Archived", status: "" },
        ].map((view) => (
          <Button
            key={view.label}
            size="xs"
            variant={
              filters.state === view.state && filters.status === view.status
                ? "secondary"
                : "ghost-muted"
            }
            aria-pressed={filters.state === view.state && filters.status === view.status}
            onClick={() => {
              setFilters((current) => ({ ...current, state: view.state, status: view.status }));
              setSelectedKeys(new Set());
            }}
          >
            {view.label}
          </Button>
        ))}
        <div className="ml-auto">
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" />}>Columns</MenuTrigger>
            <MenuPopup>
              {columns
                .filter((column) => ![SELECT_COLUMN_KEY, "title", "open"].includes(column.key))
                .map((column) => (
                  <MenuItem
                    key={column.key}
                    closeOnClick={false}
                    onClick={() =>
                      setHiddenColumns((current) => {
                        const next = new Set(current);
                        if (next.has(column.key)) next.delete(column.key);
                        else next.add(column.key);
                        return next;
                      })
                    }
                  >
                    {hiddenColumns.has(column.key) ? "Show" : "Hide"} {column.name}
                  </MenuItem>
                ))}
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="relative w-64">
          <Input
            type="search"
            aria-label="Search threads"
            placeholder="Search threads…"
            value={filters.query}
            onChange={(event) => setFilter("query", event.target.value)}
          />
        </div>
        <GridFilter
          label="State"
          value={filters.state}
          options={THREAD_STATES.map((state) => ({ value: state, label: state }))}
          onChange={(value) => setFilter("state", value)}
        />
        <GridFilter
          label="Project"
          value={filters.project}
          options={options("project")}
          onChange={(value) => setFilter("project", value)}
        />
        <GridFilter
          label="Environment"
          value={filters.environment}
          options={options("environment")}
          onChange={(value) => setFilter("environment", value)}
        />
        <GridFilter
          label="Provider"
          value={filters.provider}
          options={options("provider")}
          onChange={(value) => setFilter("provider", value)}
        />
        <GridFilter
          label="Agent status"
          value={filters.status}
          options={[{ value: "attention", label: "Needs you" }, ...options("status")]}
          onChange={(value) => setFilter("status", value)}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Group by
          <select
            aria-label="Group threads by"
            value={groupBy[0] ?? ""}
            onChange={(event) => {
              selectAllGroup.current = null;
              selectionAnchor.current = null;
              setGroupBy(event.target.value ? [event.target.value] : []);
              setExpandedGroups(new Set());
            }}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            <option value="">None</option>
            {GROUP_OPTIONS.map((key) => (
              <option key={key} value={key}>
                {key[0]?.toUpperCase()}
                {key.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {groupBy.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              const ids = Object.keys(groupThreadGridRows(visibleRows, groupBy[0] ?? "state"));
              setExpandedGroups(expandedGroups.size > 0 ? new Set() : new Set(ids));
            }}
          >
            {expandedGroups.size > 0 ? "Collapse groups" : "Expand groups"}
          </Button>
        )}
        {Object.values(filters).some(Boolean) && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setSelectedKeys(new Set());
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div role="group" aria-label="Grid interaction mode" className="flex items-center gap-1">
          <Button
            size="xs"
            variant={interactionMode === "cells" ? "secondary" : "ghost-muted"}
            aria-pressed={interactionMode === "cells"}
            onClick={() => changeInteractionMode("cells")}
          >
            Cells
          </Button>
          <Button
            size="xs"
            variant={interactionMode === "rows" ? "secondary" : "ghost-muted"}
            aria-pressed={interactionMode === "rows"}
            onClick={() => changeInteractionMode("rows")}
          >
            Rows
          </Button>
        </div>
        <span role="status" className="mr-auto text-xs text-muted-foreground">
          {hasSelection ? `${selectedRows.length} selected` : `${visibleRows.length} threads`}
        </span>
        {hasSelection ? (
          <>
            <Menu>
              <MenuTrigger
                render={
                  <Button variant="outline" size="xs" disabled={busy || !canSnoozeSelected} />
                }
              >
                <AlarmClockIcon /> Snooze
              </MenuTrigger>
              <MenuPopup>
                {resolveSnoozePresets(new Date(), timestampFormat).map((preset) => (
                  <MenuItem
                    key={preset.id}
                    onClick={() => void runAction("snooze", preset.snoozedUntil)}
                  >
                    {preset.label} · {preset.whenLabel}
                  </MenuItem>
                ))}
                <MenuItem
                  onClick={() => {
                    void (async () => {
                      const preset = await requestCustomSnooze();
                      if (preset) await runAction("snooze", preset.snoozedUntil);
                    })();
                  }}
                >
                  Custom…
                </MenuItem>
              </MenuPopup>
            </Menu>
            <Button
              variant="outline"
              size="xs"
              disabled={busy || !canArchive}
              onClick={() => void runAction("archive")}
            >
              <ArchiveIcon /> Archive
            </Button>
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="xs" disabled={busy} />}>
                More actions
              </MenuTrigger>
              <MenuPopup>
                <MenuItem disabled={!canRestore} onClick={() => void runAction("restore")}>
                  Restore archived
                </MenuItem>
                <MenuItem disabled={!canWake} onClick={() => void runAction("wake")}>
                  Wake snoozed
                </MenuItem>
                <MenuItem disabled={!canSettle} onClick={() => void runAction("settle")}>
                  Settle
                </MenuItem>
                <MenuItem disabled={!canSettle} onClick={() => void runAction("reopen")}>
                  Reopen
                </MenuItem>
                <MenuItem disabled={!canPin} onClick={() => void runAction("pin")}>
                  Pin
                </MenuItem>
                <MenuItem disabled={!canPin} onClick={() => void runAction("unpin")}>
                  Unpin
                </MenuItem>
              </MenuPopup>
            </Menu>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear selected threads"
              disabled={busy}
              onClick={() => setSelectedKeys(new Set())}
            >
              <XIcon />
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Double-click a title to edit · Click a heading to sort
          </span>
        )}
      </div>
      {archives.error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive-foreground">
          Some archived threads could not be loaded: {archives.error}{" "}
          <Button variant="ghost" size="xs" onClick={archives.refresh}>
            Retry
          </Button>
        </p>
      )}
      <div className="min-h-0 flex-1" data-thread-grid-mode={interactionMode}>
        {groupBy.length > 0 ? (
          <TreeDataGrid
            {...gridProps}
            groupBy={groupBy}
            rowGrouper={groupThreadGridRows}
            expandedGroupIds={expandedGroups}
            onExpandedGroupIdsChange={setExpandedGroups}
          />
        ) : (
          <DataGrid {...gridProps} />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          {archives.isLoading ? "Loading archived threads…" : "Across connected environments"}
        </span>
        <span>
          {interactionMode === "rows"
            ? "Cmd/Ctrl+A selects the group · Press again for all filtered threads · Escape returns to cells"
            : "Cells: Enter edits a title · Shift+Space selects a row · Cmd/Ctrl+A in an editor selects text"}
        </span>
      </div>
    </SidebarInset>
  );
}
