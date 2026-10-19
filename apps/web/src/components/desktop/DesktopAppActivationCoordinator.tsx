import {
  ConnectionBlockedError,
  ConnectionTransientError,
} from "@t3tools/client-runtime/connection";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { DesktopAppControlRequest, DesktopAppActivationResponse } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import * as Schema from "effect/Schema";

import { handleDesktopAppActivationRequest } from "../../desktopAppActivation";
import { importDesktopPairing } from "../../connection/onboarding";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../../lib/projectPaths";
import { newProjectId } from "../../lib/utils";
import { readProjects, waitForProject } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentShell } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

const isConnectionBlockedError = Schema.is(ConnectionBlockedError);
const isConnectionTransientError = Schema.is(ConnectionTransientError);

export function DesktopAppActivationCoordinator() {
  const primaryEnvironment = usePrimaryEnvironment();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importPairing = useAtomCommand(importDesktopPairing, { reportFailure: false });
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const activation = window.desktopBridge?.appActivation;
  const shell = useEnvironmentQuery(
    primaryEnvironment === null
      ? null
      : environmentShell.stateAtom(primaryEnvironment.environmentId),
  );
  const ready =
    activation !== undefined &&
    primaryEnvironment?.connection.phase === "connected" &&
    primaryEnvironment.serverConfig !== null &&
    shell.data?.snapshot._tag === "Some";

  const processRequest = useEffectEvent(
    async (request: DesktopAppControlRequest): Promise<DesktopAppActivationResponse> => {
      if (request.type === "import-pairing") {
        const result = await importPairing({ pairingUrl: request.pairingUrl });
        if (result._tag === "Success") {
          return { version: 1, requestId: request.requestId, ok: true, ...result.value };
        }
        const error = squashAtomCommandFailure(result);
        const code = isConnectionBlockedError(error)
          ? error.reason === "authentication" || error.reason === "permission"
            ? "pairing-unauthorized"
            : error.detail.includes("different environment identity") ||
                error.detail.includes("different connection type")
              ? "pairing-conflict"
              : "pairing-invalid"
          : isConnectionTransientError(error)
            ? "pairing-unavailable"
            : "pairing-storage-failed";
        const message = {
          "pairing-invalid":
            "Invalid or incompatible pairing link. Check its URL and mint a fresh link if it expired or was already used.",
          "pairing-unauthorized":
            "Pairing was rejected. The link may have expired or already been consumed; mint a fresh link.",
          "pairing-unavailable":
            "The remote server is unreachable or unavailable. The one-time link may have been submitted; check the connection before trying another link.",
          "pairing-conflict":
            "The remote address or identity conflicts with an existing saved environment.",
          "pairing-storage-failed":
            "The desktop app could not save the connection. Check its secure storage settings; use a fresh link before retrying.",
        }[code];
        return { version: 1, requestId: request.requestId, ok: false, code, message };
      }
      return handleDesktopAppActivationRequest(request, {
        getTarget: () => {
          if (
            primaryEnvironment?.connection.phase !== "connected" ||
            primaryEnvironment.serverConfig === null
          ) {
            return null;
          }
          return {
            environmentId: primaryEnvironment.environmentId,
            platform: primaryEnvironment.serverConfig.environment.platform.os,
          };
        },
        findProject: (environmentId, workspaceRoot) =>
          findProjectByPath(
            readProjects().filter((project) => project.environmentId === environmentId),
            workspaceRoot,
          ) ?? null,
        createProject: async (environmentId, workspaceRoot) => {
          const projectId = newProjectId();
          const result = await createProject({
            environmentId,
            input: {
              projectId,
              title: inferProjectTitleFromPath(workspaceRoot),
              workspaceRoot,
              createWorkspaceRootIfMissing: false,
              defaultModelSelection: null,
            },
          });
          if (result._tag === "Failure") {
            const error = squashAtomCommandFailure(result);
            throw error instanceof Error ? error : new Error("T3 Code could not add the project.");
          }
          return projectId;
        },
        waitForProject: async (projectRef) => {
          await waitForProject(projectRef);
        },
        openThread: (projectRef) => openThread(projectRef),
      });
    },
  );

  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      queueRef.current = queueRef.current.then(async () => {
        const response = await processRequest(request);
        await activation.complete(response);
      });
      queueRef.current = queueRef.current.catch(() => undefined);
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) void activation.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready]);

  return null;
}
