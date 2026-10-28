// @effect-diagnostics globalTimers:off -- The Node socket client owns its response deadline and clears it on every completion path.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodeProcess from "node:process";

import {
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  DesktopAppActivationErrorCode,
  DesktopAppActivationResponse,
  type DesktopAppActivationPlatform,
  type DesktopAppControlRequest,
} from "@t3tools/contracts";
import { resolveDesktopAppControlAddress } from "@t3tools/shared/desktopAppControl";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import {
  HostProcessPlatform,
  HostProcessUserId,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { expandHomePath, resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

const CLI_RESPONSE_TIMEOUT_MS = 17_000;
const PAIRING_RESPONSE_TIMEOUT_MS = 40_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const isDesktopAppActivationResponse = Schema.is(DesktopAppActivationResponse);
const encodePairImportResult = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      action: Schema.Literals(["added", "updated"]),
      environmentId: Schema.String,
    }),
  ),
);

export class DesktopAppSshUnsupportedError extends Schema.TaggedError<DesktopAppSshUnsupportedError>()(
  "DesktopAppSshUnsupportedError",
  {},
) {
  override get message(): string {
    return "`t3 app` only controls a desktop app on the same machine. It cannot run over SSH.";
  }
}

export class DesktopAppPlatformUnsupportedError extends Schema.TaggedError<DesktopAppPlatformUnsupportedError>()(
  "DesktopAppPlatformUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `\`t3 app\` is not supported on ${this.platform}.`;
  }
}

export class DesktopAppUnreachableError extends Schema.TaggedError<DesktopAppUnreachableError>()(
  "DesktopAppUnreachableError",
  {
    candidateAddresses: Schema.Array(Schema.String),
    requestId: Schema.String,
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not reach the TX Code desktop app. Start or update the desktop app on this machine, then run `t3 app` again. A running TX Code server is not enough.";
  }
}

export class DesktopAppRequestFailedError extends Schema.TaggedError<DesktopAppRequestFailedError>()(
  "DesktopAppRequestFailedError",
  {
    code: DesktopAppActivationErrorCode,
    requestId: Schema.String,
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `TX Code could not open ${this.workspaceRoot} (${this.code}).`;
  }
}

function isDesktopPlatform(platform: NodeJS.Platform): platform is DesktopAppActivationPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function sendDesktopAppActivationRequest(input: {
  readonly address: string;
  readonly fallbackAddress?: string;
  readonly request: DesktopAppControlRequest;
  readonly timeoutMs?: number;
}): Promise<DesktopAppActivationResponse> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(input.address);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    let connected = false;

    const finish = (
      result:
        | { readonly type: "success"; readonly response: DesktopAppActivationResponse }
        | { readonly type: "failure"; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result.type === "success") resolve(result.response);
      else reject(result.error);
    };

    const timeout = setTimeout(() => {
      finish({
        type: "failure",
        error: new Error("The desktop app did not respond in time."),
      });
    }, input.timeoutMs ?? CLI_RESPONSE_TIMEOUT_MS);

    socket.once("connect", () => {
      connected = true;
      socket.write(`${JSON.stringify(input.request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({ type: "failure", error: new Error("The desktop app response is too large.") });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish({
          type: "failure",
          error: new Error("The desktop app response is not valid JSON."),
        });
        return;
      }
      if (!isDesktopAppActivationResponse(parsed)) {
        finish({ type: "failure", error: new Error("The desktop app response is invalid.") });
        return;
      }
      if (parsed.requestId !== input.request.requestId) {
        finish({
          type: "failure",
          error: new Error("The desktop app response did not match this request."),
        });
        return;
      }
      finish({ type: "success", response: parsed });
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (
        !settled &&
        !connected &&
        input.fallbackAddress !== undefined &&
        (error.code === "ENOENT" || error.code === "ECONNREFUSED")
      ) {
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(
          sendDesktopAppActivationRequest({
            address: input.fallbackAddress,
            request: input.request,
            ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
          }),
        );
        return;
      }
      finish({ type: "failure", error });
    });
    socket.once("end", () => {
      finish({ type: "failure", error: new Error("The desktop app closed the connection.") });
    });
  });
}

const appEnvironment = Config.all({
  t3Home: Config.String("T3CODE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  sshConnection: Config.String("SSH_CONNECTION").pipe(Config.option),
  sshTty: Config.String("SSH_TTY").pipe(Config.option),
});

export class DesktopPairImportError extends Schema.TaggedError<DesktopPairImportError>()(
  "DesktopPairImportError",
  { message: Schema.String },
) {}

function readPairingUrlFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (NodeProcess.stdin.isTTY) {
      reject(new Error("Provide a pairing URL argument or pipe one on stdin."));
      return;
    }
    let value = "";
    NodeProcess.stdin.setEncoding("utf8");
    NodeProcess.stdin.on("data", (chunk: string) => {
      value += chunk;
      if (value.length > 16_384) {
        NodeProcess.stdin.pause();
        reject(new Error("Pairing link input is too large."));
      }
    });
    NodeProcess.stdin.once("end", () => resolve(value.trim()));
    NodeProcess.stdin.once("error", () =>
      reject(new Error("Could not read pairing link from stdin.")),
    );
  });
}

export const pairImportCommand = Command.make("import", {
  baseDir: baseDirFlag,
  pairingUrl: Argument.String("url").pipe(
    Argument.withDescription(
      "One-time pairing URL. Omit to read from stdin (recommended for secrets).",
    ),
    Argument.optional,
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print a JSON result without credentials."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Save or refresh a remote connection in the running desktop app."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const environment = yield* appEnvironment;
      const platform = yield* HostProcessPlatform;
      if (Option.isSome(environment.sshConnection) || Option.isSome(environment.sshTty)) {
        return yield* new DesktopAppSshUnsupportedError({});
      }
      if (!isDesktopPlatform(platform)) {
        return yield* new DesktopAppPlatformUnsupportedError({ platform });
      }
      const pairingUrl =
        Option.getOrUndefined(flags.pairingUrl) ??
        (yield* Effect.tryPromise({
          try: readPairingUrlFromStdin,
          catch: () =>
            new DesktopPairImportError({ message: "Could not read a pairing URL from stdin." }),
        }));
      yield* Effect.try({
        try: () => resolveRemotePairingTarget({ pairingUrl }),
        catch: () =>
          new DesktopPairImportError({ message: "Invalid pairing URL or missing token." }),
      });
      const path = yield* Path.Path;
      const configuredBaseDir = Option.getOrUndefined(flags.baseDir) ?? environment.t3Home;
      const baseDir = yield* resolveBaseDir(configuredBaseDir);
      const userId = yield* HostProcessUserId;
      const addressFor = (subdirectory: "userdata" | "dev") =>
        resolveDesktopAppControlAddress({
          stateDir: path.join(baseDir, subdirectory),
          platform,
          tempDir: NodeOS.tmpdir(),
          userId,
          joinPath: path.join,
        }).address;
      const address = addressFor("userdata");
      const fallbackAddress =
        Option.isNone(flags.baseDir) && !environment.t3Home?.trim() ? addressFor("dev") : undefined;
      const response = yield* Effect.tryPromise({
        try: () =>
          sendDesktopAppActivationRequest({
            address,
            ...(fallbackAddress === undefined ? {} : { fallbackAddress }),
            request: {
              version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
              requestId: NodeCrypto.randomUUID(),
              type: "import-pairing",
              pairingUrl,
            },
            timeoutMs: PAIRING_RESPONSE_TIMEOUT_MS,
          }),
        catch: () =>
          new DesktopPairImportError({
            message:
              "Could not reach a compatible TX Code desktop app. Start or update the app on this machine; if a link was submitted, check Connections before using a fresh link.",
          }),
      });
      if (!response.ok) {
        const messages: Partial<Record<DesktopAppActivationErrorCode, string>> = {
          "invalid-request": "The desktop app does not support pairing import. Update it first.",
          "renderer-unavailable":
            "The desktop window is not ready. Open it and try a fresh link if needed.",
          "request-timeout":
            "The desktop app timed out. Check Connections before using a fresh link.",
          "pairing-invalid":
            "Invalid or incompatible pairing link. Mint a fresh link if it expired or was already used.",
          "pairing-unauthorized":
            "Pairing was rejected. Mint a fresh link if it expired or was already used.",
          "pairing-unavailable":
            "Remote server unavailable. Check Connections before using a fresh link.",
          "pairing-conflict": "The remote address or identity conflicts with a saved environment.",
          "pairing-storage-failed":
            "Desktop secure storage could not save the connection. Check Connections before using a fresh link.",
        };
        const message =
          messages[response.code] ?? "The desktop app could not import the pairing link.";
        return yield* new DesktopPairImportError({ message });
      }
      if (!("environmentId" in response)) {
        return yield* new DesktopPairImportError({
          message: "The desktop app does not support pairing import. Update it first.",
        });
      }
      const result = {
        action: response.action,
        environmentId: response.environmentId,
      };
      yield* Console.log(
        flags.json
          ? encodePairImportResult(result)
          : `${result.action === "added" ? "Added" : "Updated"} environment ${result.environmentId} in the desktop app.`,
      );
    }),
  ),
);

const runAppCommand = Effect.fn("cli.app")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly workspaceRoot: Option.Option<string>;
}) {
  const environment = yield* appEnvironment;
  const hostPlatform = yield* HostProcessPlatform;
  if (Option.isSome(environment.sshConnection) || Option.isSome(environment.sshTty)) {
    return yield* new DesktopAppSshUnsupportedError({});
  }
  if (!isDesktopPlatform(hostPlatform)) {
    return yield* new DesktopAppPlatformUnsupportedError({ platform: hostPlatform });
  }

  const path = yield* Path.Path;
  const configuredBaseDir = Option.getOrUndefined(flags.baseDir) ?? environment.t3Home;
  const baseDir = yield* resolveBaseDir(configuredBaseDir);
  const allowDevFallback = Option.isNone(flags.baseDir) && !environment.t3Home?.trim();
  const rawWorkspaceRoot =
    Option.getOrUndefined(flags.workspaceRoot) ?? (yield* HostProcessWorkingDirectory);
  const workspaceRoot = path.resolve(yield* expandHomePath(rawWorkspaceRoot));
  const userId = yield* HostProcessUserId;
  const resolveAddress = (stateSubdirectory: "userdata" | "dev") =>
    resolveDesktopAppControlAddress({
      stateDir: path.join(baseDir, stateSubdirectory),
      platform: hostPlatform,
      tempDir: NodeOS.tmpdir(),
      userId,
      joinPath: path.join,
    }).address;
  const request: DesktopAppControlRequest = {
    version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
    requestId: NodeCrypto.randomUUID(),
    type: "open-workspace",
    workspaceRoot,
    platform: hostPlatform,
  };
  const address = resolveAddress("userdata");
  const fallbackAddress = allowDevFallback ? resolveAddress("dev") : undefined;

  const response = yield* Effect.tryPromise({
    try: () =>
      sendDesktopAppActivationRequest({
        address,
        ...(fallbackAddress === undefined ? {} : { fallbackAddress }),
        request,
      }),
    catch: (cause) =>
      new DesktopAppUnreachableError({
        candidateAddresses: fallbackAddress === undefined ? [address] : [address, fallbackAddress],
        requestId: request.requestId,
        workspaceRoot,
        cause,
      }),
  });
  if (!response.ok || !("projectId" in response)) {
    return yield* new DesktopAppRequestFailedError({
      code: response.ok ? "invalid-request" : response.code,
      requestId: response.requestId,
      workspaceRoot,
      cause: response,
    });
  }

  yield* Console.log(`Opened ${workspaceRoot} in TX Code.`);
});

export const appCommand = Command.make("app", {
  baseDir: baseDirFlag,
  workspaceRoot: Argument.String("path").pipe(
    Argument.withDescription("Project directory. Default: current directory."),
    Argument.optional,
  ),
}).pipe(
  Command.withDescription("Open a project in the running TX Code desktop app."),
  Command.withHandler(runAppCommand),
);
