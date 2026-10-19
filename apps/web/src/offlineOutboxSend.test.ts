import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { OfflineOutboxTurn } from "./offlineOutbox";

const mocks = vi.hoisted(() => ({
  turn: null as OfflineOutboxTurn | null,
  commands: [] as Array<{ command: unknown; input: unknown }>,
  finish: vi.fn(),
  fail: vi.fn(),
  markPromoted: vi.fn(),
  readFileAsDataUrl: vi.fn(async () => "data:image/png;base64,aW1hZ2U="),
  startTurn: Symbol("start-turn"),
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: async (_registry: unknown, command: unknown, input: unknown) => {
    mocks.commands.push({ command, input });
    return { _tag: "Success", value: undefined };
  },
  squashAtomCommandFailure: (result: { error: unknown }) => result.error,
}));
vi.mock("./rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () =>
      new Map([
        [
          "remote",
          {
            environment: {
              capabilities: { attachmentUploads: false, inlineMessageContext: false },
            },
          },
        ],
      ]),
  },
}));
vi.mock("./state/server", () => ({ environmentServerConfigsAtom: Symbol("configs") }));
vi.mock("./state/entities", () => ({ readThreadShell: () => null }));
vi.mock("./state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("./state/threads", () => ({ threadEnvironment: { startTurn: mocks.startTurn } }));
vi.mock("./composerDraftStore", () => ({ markPromotedDraftThreadByRef: mocks.markPromoted }));
vi.mock("./lib/imageCompression", () => ({ readFileAsDataUrl: mocks.readFileAsDataUrl }));
vi.mock("./lib/composerContextRecords", () => ({ buildMessageContext: () => undefined }));
vi.mock("./lib/attachmentUploadQueue", () => ({
  awaitAttachmentUploads: vi.fn(),
  getUploadedAttachments: vi.fn(),
  readAttachmentUpload: vi.fn(),
  releaseDraftAttachments: vi.fn(),
  retryAttachmentUpload: vi.fn(),
  startAttachmentUpload: vi.fn(),
}));
vi.mock("./components/chat/composerAttachmentFiles", () => ({
  fileAttachmentCapabilityBlockReason: () => null,
}));
vi.mock("./components/ChatView.logic", () => ({
  resolveThreadMetadataUpdateForNextTurn: () => null,
}));
vi.mock("./offlineOutbox", () => ({
  useOfflineOutbox: {
    getState: () => ({
      begin: () => mocks.turn,
      finish: mocks.finish,
      fail: mocks.fail,
    }),
  },
}));

import { sendOfflineOutboxTurn } from "./offlineOutboxSend";

beforeEach(() => {
  mocks.commands.length = 0;
  mocks.finish.mockClear();
  mocks.fail.mockClear();
  mocks.markPromoted.mockClear();
});

it("replays a saved draft with its original ids, bootstrap, and image after reconnect", async () => {
  const environmentId = EnvironmentId.make("remote");
  const projectId = ProjectId.make("project");
  const threadId = ThreadId.make("draft");
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" };
  mocks.turn = {
    id: "message-1",
    environmentId,
    projectId,
    threadId,
    createdAt: "2026-10-19T00:00:00.000Z",
    text: "Build the feature",
    draftPrompt: "Build the feature",
    titleSeed: "Build the feature",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    dispatchMode: "queue",
    compactBeforeSend: false,
    images: [
      {
        type: "image",
        id: "image-1",
        name: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 5,
        previewUrl: "blob:old-preview",
        file: new File(["image"], "diagram.png", { type: "image/png" }),
      },
    ],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    threadContexts: [],
    bootstrap: {
      createThread: {
        projectId,
        title: "Build the feature",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: "2026-10-19T00:00:00.000Z",
      },
    },
  };

  await sendOfflineOutboxTurn("message-1");

  expect(mocks.commands).toHaveLength(1);
  expect(mocks.commands[0]?.command).toBe(mocks.startTurn);
  expect(mocks.commands[0]?.input).toMatchObject({
    environmentId,
    input: {
      commandId: "message-1",
      threadId,
      message: {
        messageId: "message-1",
        text: "Build the feature",
        attachments: [{ id: "image-1", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
      },
      bootstrap: { createThread: { projectId } },
    },
  });
  expect(mocks.finish).toHaveBeenCalledWith("message-1");
  expect(mocks.markPromoted).toHaveBeenCalledWith({ environmentId, threadId });
  expect(mocks.fail).not.toHaveBeenCalled();
});
