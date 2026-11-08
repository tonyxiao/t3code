// @effect-diagnostics nodeBuiltinImport:off -- CLI message input may come from stdin.
import * as NodeCrypto from "node:crypto";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  EnvironmentHttpApi,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadDetailSnapshot,
  ThreadId,
  type OrchestrationV2Command,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export class ThreadCliError extends Schema.TaggedError<ThreadCliError>()("ThreadCliError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.detail;
  }
}

const threadArgument = Argument.String("thread").pipe(
  Argument.withDescription("Thread id; defaults to T3_THREAD_ID inside an agent session."),
  Argument.optional,
);
const durationFlag = Flag.String("for").pipe(
  Flag.withDescription("Snooze duration, such as 1h or 2d."),
  Flag.optional,
);
const untilFlag = Flag.String("until").pipe(
  Flag.withDescription("ISO-8601 wake time."),
  Flag.optional,
);
const headers = (token: string) =>
  ({
    authorization: `Bearer ${token}`,
    [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  }) as const;
const makeClient = (origin: string) => HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
function targetThread(snapshot: OrchestrationV2ShellSnapshot, explicit: string | undefined) {
  const id = explicit?.trim() || process.env.T3_THREAD_ID?.trim();
  if (!id) throw new ThreadCliError({ detail: "Pass a thread id or run inside a T3 thread." });
  const thread = snapshot.threads.find((candidate) => candidate.id === id);
  if (!thread) throw new ThreadCliError({ detail: `Thread ${id} was not found.` });
  return thread;
}

export function wakeAt(
  duration: string | undefined,
  until: string | undefined,
  nowMs: number,
): string {
  if ((duration === undefined) === (until === undefined)) {
    throw new ThreadCliError({ detail: "Pass exactly one of --for or --until." });
  }
  let wakeMs: number;
  if (duration !== undefined) {
    const match = /^(\d+)\s*(m|h|d|w|minutes?|hours?|days?|weeks?)$/iu.exec(duration.trim());
    if (!match) throw new ThreadCliError({ detail: "Use a duration such as 30m, 2h, 3d, or 1w." });
    const unit = match[2]!.toLowerCase()[0] as "m" | "h" | "d" | "w";
    const milliseconds = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
    wakeMs = nowMs + Number(match[1]) * milliseconds;
  } else {
    const parsed = DateTime.make(until!);
    if (Option.isNone(parsed))
      throw new ThreadCliError({ detail: "Wake time must be a valid ISO-8601 date." });
    wakeMs = DateTime.toEpochMillis(parsed.value);
  }
  if (!Number.isFinite(wakeMs) || wakeMs <= nowMs) {
    throw new ThreadCliError({ detail: "Wake time must be a valid future date." });
  }
  return DateTime.formatIso(DateTime.makeUnsafe(wakeMs));
}

function commandId(): CommandId {
  return CommandId.make(`cli:${NodeCrypto.randomUUID()}`);
}

const runCli = Effect.fn("cli.thread.run")(function* <A, E, R>(
  flags: CliAuthLocationFlags,
  run: (context: {
    readonly snapshot: OrchestrationV2ShellSnapshot;
    readonly fetchDetail: (
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadDetailSnapshot, ThreadCliError>;
    readonly fetchRecent: (
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadBoundedSnapshot, ThreadCliError>;
    readonly dispatch: (command: OrchestrationV2Command) => Effect.Effect<void, ThreadCliError>;
  }) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  const runtime = EnvironmentAuth.layerRuntime.pipe(
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(ServerConfig.layer(config)),
    Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
  );
  return yield* Effect.gen(function* () {
    const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(state))
      return yield* new ThreadCliError({ detail: "No running TX Code server is available." });
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* Effect.acquireUseRelease(
      auth.issueSession({
        scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
        label: "t3 thread cli",
      }),
      (session) =>
        Effect.gen(function* () {
          const client = yield* makeClient(state.value.origin);
          const fetchShell = client.orchestration
            .shellSnapshot({ headers: headers(session.token), query: {} })
            .pipe(
              Effect.timeout(Duration.seconds(5)),
              Effect.mapError(
                (cause) =>
                  new ThreadCliError({
                    detail: "Could not read threads from the running server.",
                    cause,
                  }),
              ),
            );
          const snapshot = yield* fetchShell;
          return yield* run({
            snapshot,
            fetchDetail: (threadId) =>
              client.orchestration
                .threadSnapshot({
                  headers: headers(session.token),
                  params: { threadId },
                })
                .pipe(
                  Effect.timeout(Duration.seconds(15)),
                  Effect.mapError(
                    (cause) =>
                      new ThreadCliError({ detail: `Could not read thread ${threadId}.`, cause }),
                  ),
                ),
            fetchRecent: (threadId) =>
              client.orchestration
                .threadBoundedSnapshot({
                  headers: headers(session.token),
                  params: { threadId },
                  query: {},
                })
                .pipe(
                  Effect.timeout(Duration.seconds(15)),
                  Effect.mapError(
                    (cause) =>
                      new ThreadCliError({ detail: `Could not follow thread ${threadId}.`, cause }),
                  ),
                ),
            dispatch: (command) =>
              client.orchestration
                .dispatchCommand({
                  headers: headers(session.token),
                  payload: command,
                } as Parameters<typeof client.orchestration.dispatchCommand>[0])
                .pipe(
                  Effect.asVoid,
                  Effect.timeout(Duration.seconds(10)),
                  Effect.mapError(
                    (cause) =>
                      new ThreadCliError({
                        detail: "The server rejected the thread command.",
                        cause,
                      }),
                  ),
                ),
          });
        }),
      (session) => auth.revokeSession(session.sessionId).pipe(Effect.ignore({ log: true })),
    );
  }).pipe(Effect.scoped, Effect.provide(runtime));
});

export const snoozeCommand = Command.make("snooze", {
  ...projectLocationFlags,
  thread: threadArgument,
  duration: durationFlag,
  until: untilFlag,
}).pipe(
  Command.withDescription("Snooze a thread until a future time."),
  Command.withHandler(({ thread, duration, until, ...location }) =>
    runCli(location, ({ snapshot, dispatch }) =>
      Effect.gen(function* () {
        const target = targetThread(snapshot, Option.getOrUndefined(thread));
        const time = wakeAt(
          Option.getOrUndefined(duration),
          Option.getOrUndefined(until),
          DateTime.toEpochMillis(yield* DateTime.now),
        );
        yield* dispatch({
          type: "thread.snooze",
          commandId: commandId(),
          threadId: target.id,
          snoozedUntil: time,
        });
        yield* Console.log(`Snoozed ${target.id} until ${time}`);
      }),
    ),
  ),
);

export const wakeCommand = Command.make("wake", {
  ...projectLocationFlags,
  thread: threadArgument,
}).pipe(
  Command.withDescription("Wake a snoozed thread."),
  Command.withHandler(({ thread, ...location }) =>
    runCli(location, ({ snapshot, dispatch }) =>
      Effect.gen(function* () {
        const target = targetThread(snapshot, Option.getOrUndefined(thread));
        yield* dispatch({
          type: "thread.unsnooze",
          commandId: commandId(),
          threadId: target.id,
          reason: "user",
        });
        yield* Console.log(`Woke ${target.id}`);
      }),
    ),
  ),
);

export const interruptCommand = Command.make("interrupt", {
  ...projectLocationFlags,
  thread: threadArgument,
}).pipe(
  Command.withDescription("Interrupt the active run in a thread."),
  Command.withHandler(({ thread, ...location }) =>
    runCli(location, ({ snapshot, dispatch }) =>
      Effect.gen(function* () {
        const target = targetThread(snapshot, Option.getOrUndefined(thread));
        if (!target.activeRunId)
          return yield* new ThreadCliError({ detail: "This thread has no active run." });
        yield* dispatch({
          type: "run.interrupt",
          commandId: commandId(),
          threadId: target.id,
          runId: target.activeRunId,
        });
        yield* Console.log(`Interrupted ${target.id}`);
      }),
    ),
  ),
);
