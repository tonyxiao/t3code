import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

const connection = vi.hoisted(() => ({ phase: "reconnecting" }));

vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: connection.phase } }),
}));
vi.mock("../state/shell", () => ({ useEnvironmentShellHasSnapshot: () => true }));
vi.mock("../offlineOutboxSend", () => ({ sendOfflineOutboxTurn: vi.fn() }));
import { OfflineOutboxSender } from "./OfflineOutboxSender";
import { useOfflineOutbox, type OfflineOutboxTurn } from "../offlineOutbox";
import { sendOfflineOutboxTurn } from "../offlineOutboxSend";

let root: Root;

const turn: OfflineOutboxTurn = {
  id: "saved-turn",
  environmentId: EnvironmentId.make("remote"),
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("thread"),
  createdAt: "2026-10-19T00:00:00.000Z",
  text: "Work offline",
  draftPrompt: "Work offline",
  titleSeed: "Work offline",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  dispatchMode: "auto",
  compactBeforeSend: false,
  images: [],
  files: [],
  terminalContexts: [],
  previewAnnotations: [],
  reviewComments: [],
  threadContexts: [],
  blockedReason: "Waiting for connection",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  connection.phase = "reconnecting";
  useOfflineOutbox.setState({
    turns: [turn],
    hydrated: true,
    sendingIds: new Set(),
    retry: async (id) => {
      useOfflineOutbox.setState((state) => ({
        turns: state.turns.map((item) => {
          if (item.id !== id) return item;
          const { blockedReason: _blockedReason, ...ready } = item;
          return ready;
        }),
      }));
    },
  });
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("sends a saved turn after reconnect and waits for another reconnect after a transient failure", async () => {
  await act(() => root.render(<OfflineOutboxSender />));
  expect(sendOfflineOutboxTurn).not.toHaveBeenCalled();

  connection.phase = "connected";
  await act(() => useOfflineOutbox.setState({ turns: [{ ...turn }] }));
  expect(useOfflineOutbox.getState().turns[0]?.blockedReason).toBeUndefined();
  expect(sendOfflineOutboxTurn).toHaveBeenCalledExactlyOnceWith(turn.id);

  await act(() => useOfflineOutbox.setState({ turns: [turn] }));
  expect(sendOfflineOutboxTurn).toHaveBeenCalledTimes(1);

  connection.phase = "reconnecting";
  await act(() => useOfflineOutbox.setState({ turns: [{ ...turn }] }));
  connection.phase = "connected";
  await act(() => useOfflineOutbox.setState({ turns: [{ ...turn }] }));
  expect(sendOfflineOutboxTurn).toHaveBeenCalledTimes(2);
});
