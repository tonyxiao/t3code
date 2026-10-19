import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION = 1 as const;

export const DesktopAppActivationPlatform = Schema.Literals(["darwin", "linux", "win32"]);
export type DesktopAppActivationPlatform = typeof DesktopAppActivationPlatform.Type;

const DesktopAppRequestBase = {
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
};

export const DesktopAppActivationRequest = Schema.Struct({
  ...DesktopAppRequestBase,
  type: Schema.Literal("open-workspace"),
  workspaceRoot: TrimmedNonEmptyString,
  platform: DesktopAppActivationPlatform,
});
export type DesktopAppActivationRequest = typeof DesktopAppActivationRequest.Type;

export const DesktopAppPairingRequest = Schema.Struct({
  ...DesktopAppRequestBase,
  type: Schema.Literal("import-pairing"),
  pairingUrl: TrimmedNonEmptyString,
});
export type DesktopAppPairingRequest = typeof DesktopAppPairingRequest.Type;

export const DesktopAppControlRequest = Schema.Union([
  DesktopAppActivationRequest,
  DesktopAppPairingRequest,
]);
export type DesktopAppControlRequest = typeof DesktopAppControlRequest.Type;

export const DesktopAppActivationErrorCode = Schema.Literals([
  "invalid-request",
  "renderer-unavailable",
  "environment-unavailable",
  "platform-mismatch",
  "project-create-failed",
  "thread-open-failed",
  "request-timeout",
  "internal-error",
  "pairing-invalid",
  "pairing-unauthorized",
  "pairing-unavailable",
  "pairing-conflict",
  "pairing-storage-failed",
]);
export type DesktopAppActivationErrorCode = typeof DesktopAppActivationErrorCode.Type;

export const DesktopAppActivationSuccess = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(true),
  projectId: ProjectId,
  threadId: ThreadId,
});
export type DesktopAppActivationSuccess = typeof DesktopAppActivationSuccess.Type;

export const DesktopAppPairingSuccess = Schema.Struct({
  ...DesktopAppRequestBase,
  ok: Schema.Literal(true),
  environmentId: TrimmedNonEmptyString,
  action: Schema.Literals(["added", "updated"]),
});
export type DesktopAppPairingSuccess = typeof DesktopAppPairingSuccess.Type;

export const DesktopAppActivationFailure = Schema.Struct({
  version: Schema.Literal(DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION),
  requestId: TrimmedNonEmptyString,
  ok: Schema.Literal(false),
  code: DesktopAppActivationErrorCode,
  message: TrimmedNonEmptyString,
});
export type DesktopAppActivationFailure = typeof DesktopAppActivationFailure.Type;

export const DesktopAppActivationResponse = Schema.Union([
  DesktopAppActivationSuccess,
  DesktopAppPairingSuccess,
  DesktopAppActivationFailure,
]);
export type DesktopAppActivationResponse = typeof DesktopAppActivationResponse.Type;
