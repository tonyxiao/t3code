import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  MessageId,
  type ChatAttachment,
  type UploadChatAttachment,
} from "@t3tools/contracts";

import { markPromotedDraftThreadByRef } from "./composerDraftStore";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readThreadShell, waitForThreadShell } from "./state/entities";
import { readEnvironmentScope } from "./state/session";
import { environmentServerConfigsAtom } from "./state/server";
import { threadEnvironment } from "./state/threads";
import { readFileAsDataUrl } from "./lib/imageCompression";
import { buildMessageContext } from "./lib/composerContextRecords";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseDraftAttachments,
  retryAttachmentUpload,
  startAttachmentUpload,
} from "./lib/attachmentUploadQueue";
import { fileAttachmentCapabilityBlockReason } from "./components/chat/composerAttachmentFiles";
import { resolveThreadMetadataUpdateForNextTurn } from "./components/ChatView.logic";
import { useOfflineOutbox } from "./offlineOutbox";

async function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

export function isRetryableOfflineOutboxError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    return [
      "ConnectionTransientError",
      "RpcClientError",
      "EnvironmentRpcUnavailableError",
      "EnvironmentNotRegisteredError",
    ].includes(String(error._tag));
  }
  return error instanceof Error && isTransportConnectionErrorMessage(error.message);
}

/** Replays one durable turn with its original command and message id. */
export async function sendOfflineOutboxTurn(id: string): Promise<void> {
  const queue = useOfflineOutbox.getState();
  const turn = queue.begin(id);
  if (!turn) return;
  const { environmentId, threadId } = turn;
  const threadRef = scopeThreadRef(environmentId, threadId);
  const attachments = [...turn.images, ...turn.files];
  const readConfig = () => appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  try {
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      throw new Error("This connection no longer permits sending messages.");
    }
    if (turn.files.some((file) => file.file === null)) {
      throw new Error("A queued file needs to be attached again before it can be sent.");
    }
    const config = readConfig();
    const useUploads = config?.environment.capabilities.attachmentUploads === true;
    const fileBlockReason = fileAttachmentCapabilityBlockReason({
      files: turn.files,
      attachmentUploadsCapabilityKnown: config !== undefined,
      supportsAttachmentUploads: useUploads,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
    });
    if (fileBlockReason) throw new Error(fileBlockReason);

    if (useUploads) {
      for (const attachment of attachments) {
        const start =
          readAttachmentUpload(attachment.id)?.status === "failed"
            ? retryAttachmentUpload
            : startAttachmentUpload;
        start({ environmentId, image: attachment, draftTarget: threadRef });
      }
      await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
    }
    const wireAttachments: Array<ChatAttachment | UploadChatAttachment> = await Promise.all(
      attachments.map(async (attachment) => {
        if (useUploads) {
          const uploaded = getUploadedAttachments({ environmentId, images: [attachment] })?.[0];
          if (!uploaded) throw new Error(`Attachment '${attachment.name}' did not upload.`);
          return uploaded;
        }
        if (attachment.type !== "image")
          throw new Error("This server cannot receive file attachments.");
        return {
          type: "image" as const,
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          dataUrl: await readFileAsDataUrl(attachment.file),
          ...(attachment.source ? { source: attachment.source } : {}),
        };
      }),
    );
    const context = buildMessageContext({
      terminalContexts: turn.terminalContexts,
      reviewComments: turn.reviewComments,
      previewAnnotations: turn.previewAnnotations,
      threadContexts: turn.threadContexts,
      attachments: attachments.map((attachment, index) => ({
        attachment,
        attachmentId: wireAttachments[index]?.id ?? attachment.id,
      })),
    });
    const inlineContext = readConfig()?.environment.capabilities.inlineMessageContext === true;
    const outgoingText =
      turn.legacyPromptEffort === undefined
        ? turn.text
        : applyClaudePromptEffortPrefix(turn.text, turn.legacyPromptEffort);
    const text =
      context && !inlineContext
        ? serializeLegacyContextMessage({ text: outgoingText, records: context.records })
        : outgoingText;
    if (!turn.bootstrap?.createThread && !readThreadShell(threadRef)) {
      await waitForThreadShell(threadRef);
    }
    const shell = turn.bootstrap?.createThread ? null : readThreadShell(threadRef);
    if (!shell && !turn.bootstrap?.createThread) {
      throw new Error(
        "The target thread is no longer available. Open the queued draft to recover it.",
      );
    }
    const metadataUpdate = shell
      ? resolveThreadMetadataUpdateForNextTurn({
          currentModelSelection: shell.modelSelection,
          nextModelSelection: turn.modelSelection,
          currentBranch: shell.branch,
        })
      : null;
    if (metadataUpdate) {
      await run(threadEnvironment.updateMetadata, {
        environmentId,
        input: { threadId, ...metadataUpdate },
      });
    }
    if (shell && shell.runtimeMode !== turn.runtimeMode) {
      await run(threadEnvironment.setRuntimeMode, {
        environmentId,
        input: { threadId, runtimeMode: turn.runtimeMode, createdAt: turn.createdAt },
      });
    }
    if (shell && shell.interactionMode !== turn.interactionMode) {
      await run(threadEnvironment.setInteractionMode, {
        environmentId,
        input: { threadId, interactionMode: turn.interactionMode, createdAt: turn.createdAt },
      });
    }
    if (turn.compactBeforeSend) {
      await run(threadEnvironment.startTurn, {
        environmentId,
        input: {
          commandId: CommandId.make(`${id}:compact`),
          threadId,
          message: {
            messageId: MessageId.make(`${id}:compact`),
            role: "user",
            text: "/compact",
            attachments: [],
          },
          modelSelection: turn.modelSelection,
          runtimeMode: turn.runtimeMode,
          interactionMode: turn.interactionMode,
        },
      });
    }
    await run(threadEnvironment.startTurn, {
      environmentId,
      input: {
        commandId: CommandId.make(id),
        threadId,
        message: {
          messageId: MessageId.make(id),
          role: "user",
          text,
          attachments: wireAttachments,
          ...(context && inlineContext ? { context } : {}),
        },
        modelSelection: turn.modelSelection,
        titleSeed: turn.titleSeed,
        runtimeMode: turn.runtimeMode,
        interactionMode: turn.interactionMode,
        dispatchMode: turn.compactBeforeSend ? "queue" : turn.dispatchMode,
        ...(turn.bootstrap ? { bootstrap: turn.bootstrap } : {}),
        createdAt: turn.createdAt,
      },
    });
    if (turn.bootstrap?.createThread) markPromotedDraftThreadByRef(threadRef);
    await useOfflineOutbox.getState().finish(id);
    if (useUploads) releaseDraftAttachments(attachments);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await useOfflineOutbox.getState().fail(id, reason, isRetryableOfflineOutboxError(error));
    } catch {
      // The store reports its persistence error while retaining the saved turn.
    }
  }
}
