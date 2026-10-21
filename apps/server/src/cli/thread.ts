// @effect-diagnostics nodeBuiltinImport:off -- CLI message input may come from stdin.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentHttpApi,
  MessageId,
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadBoundedSnapshot,
  OrchestrationV2ThreadDetailSnapshot,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
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
const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print JSON."),
  Flag.withDefault(false),
);
const followFlag = Flag.Boolean("follow").pipe(
  Flag.withDescription("Print the reply as it arrives, then exit when the run finishes."),
  Flag.withDefault(false),
);
const projectFlag = Flag.String("project").pipe(
  Flag.withDescription("Project id, title, or workspace path."),
  Flag.optional,
);
const providerFlag = Flag.String("provider").pipe(
  Flag.withDescription("Provider instance id."),
  Flag.optional,
);
const modelFlag = Flag.String("model").pipe(Flag.withDescription("Model id."), Flag.optional);
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
const encodeShell = Schema.encodeEffect(Schema.fromJsonString(OrchestrationV2ShellSnapshot));
const encodeDetail = Schema.encodeEffect(
  Schema.fromJsonString(OrchestrationV2ThreadDetailSnapshot),
);

function targetThread(snapshot: OrchestrationV2ShellSnapshot, explicit: string | undefined) {
  const id = explicit?.trim() || process.env.T3_THREAD_ID?.trim();
  if (!id) throw new ThreadCliError({ detail: "Pass a thread id or run inside a T3 thread." });
  const thread = snapshot.threads.find((candidate) => candidate.id === id);
  if (!thread) throw new ThreadCliError({ detail: `Thread ${id} was not found.` });
  return thread;
}

function targetProject(snapshot: OrchestrationV2ShellSnapshot, selector: string | undefined) {
  if (selector) {
    const project = snapshot.projects.find(
      (candidate) =>
        candidate.id === selector ||
        candidate.title === selector ||
        candidate.workspaceRoot === selector.replace(/\/+$/u, ""),
    );
    if (!project) throw new ThreadCliError({ detail: `Project ${selector} was not found.` });
    return project;
  }
  const cwd = process.cwd();
  const project = snapshot.projects
    .filter(
      (candidate) =>
        cwd === candidate.workspaceRoot || cwd.startsWith(`${candidate.workspaceRoot}/`),
    )
    .toSorted((left, right) => right.workspaceRoot.length - left.workspaceRoot.length)[0];
  if (!project)
    throw new ThreadCliError({ detail: "No T3 project contains this directory. Pass --project." });
  return project;
}

function modelSelection(
  snapshot: OrchestrationV2ShellSnapshot,
  project: OrchestrationProjectShell,
  provider: string | undefined,
  model: string | undefined,
) {
  const recent = snapshot.threads
    .filter((thread) => thread.projectId === project.id)
    .toSorted(
      (left, right) =>
        DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
    )[0];
  const base = project.defaultModelSelection ?? recent?.modelSelection;
  if (provider && provider !== base?.instanceId && !model) {
    throw new ThreadCliError({ detail: "--provider requires --model." });
  }
  if (provider && model) return { instanceId: ProviderInstanceId.make(provider), model };
  if (model && base) return { instanceId: base.instanceId, model };
  if (base) return base;
  throw new ThreadCliError({
    detail: "This project has no default model. Pass --provider and --model.",
  });
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

function formatThread(thread: OrchestrationV2ThreadShell): string {
  return `${thread.id}\t${thread.status}\t${thread.title}`;
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
      return yield* new ThreadCliError({ detail: "No running txcode server is available." });
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
            .shellSnapshot({ headers: headers(session.token) })
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

const listCommand = Command.make("list", { ...projectLocationFlags, json: jsonFlag }).pipe(
  Command.withDescription("List active threads."),
  Command.withHandler(({ json, ...location }) =>
    runCli(location, ({ snapshot }) =>
      Effect.gen(function* () {
        yield* Console.log(
          json ? yield* encodeShell(snapshot) : snapshot.threads.map(formatThread).join("\n"),
        );
      }),
    ),
  ),
);

const showCommand = Command.make("show", {
  ...projectLocationFlags,
  thread: threadArgument,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Show a thread and its messages."),
  Command.withHandler(({ thread, json, ...location }) =>
    runCli(location, ({ snapshot, fetchDetail }) =>
      Effect.gen(function* () {
        const target = targetThread(snapshot, Option.getOrUndefined(thread));
        const detail = yield* fetchDetail(target.id);
        yield* Console.log(
          json
            ? yield* encodeDetail(detail)
            : `${formatThread(target)}\n\n${detail.projection.messages.map((message) => `${message.role}: ${message.text}`).join("\n\n")}`,
        );
      }),
    ),
  ),
);

const snoozeCommand = Command.make("snooze", {
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

const wakeCommand = Command.make("wake", { ...projectLocationFlags, thread: threadArgument }).pipe(
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

const interruptCommand = Command.make("interrupt", {
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

function messageText(argument: string | undefined): string {
  const value = argument ?? (process.stdin.isTTY ? "" : NodeFS.readFileSync(0, "utf8"));
  if (!value.trim()) throw new ThreadCliError({ detail: "Pass a message or pipe one on stdin." });
  return value;
}

const sendCommand = Command.make("send", {
  ...projectLocationFlags,
  thread: threadArgument,
  message: Argument.String("message").pipe(Argument.optional),
  follow: followFlag,
}).pipe(
  Command.withDescription("Send a message to a thread."),
  Command.withHandler(({ thread, message, follow, ...location }) =>
    runCli(location, ({ snapshot, fetchRecent, dispatch }) =>
      Effect.gen(function* () {
        const target = targetThread(snapshot, Option.getOrUndefined(thread));
        const text = messageText(Option.getOrUndefined(message));
        const id = MessageId.make(`cli:${NodeCrypto.randomUUID()}`);
        yield* dispatch({
          type: "message.dispatch",
          commandId: commandId(),
          threadId: target.id,
          messageId: id,
          text,
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "user",
          creationSource: "server",
        });
        yield* Console.log(`Sent to ${target.id}`);
        if (follow) yield* followReply(target.id, id, fetchRecent);
      }),
    ),
  ),
);

const newCommand = Command.make("new", {
  ...projectLocationFlags,
  project: projectFlag,
  provider: providerFlag,
  model: modelFlag,
  message: Argument.String("message").pipe(Argument.optional),
  follow: followFlag,
}).pipe(
  Command.withDescription("Create a thread, optionally starting its first turn."),
  Command.withHandler(({ project, provider, model, message, follow, ...location }) =>
    runCli(location, ({ snapshot, fetchRecent, dispatch }) =>
      Effect.gen(function* () {
        const selected = targetProject(snapshot, Option.getOrUndefined(project));
        const selection = modelSelection(
          snapshot,
          selected,
          Option.getOrUndefined(provider),
          Option.getOrUndefined(model),
        );
        const recent = snapshot.threads
          .filter((thread) => thread.projectId === selected.id)
          .toSorted(
            (left, right) =>
              DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
          )[0];
        const text = Option.getOrUndefined(message);
        const id = ThreadId.make(NodeCrypto.randomUUID());
        const title = text?.trim().split("\n", 1)[0]?.slice(0, 60).trim() || "New thread";
        yield* dispatch({
          type: "thread.create",
          commandId: commandId(),
          threadId: id,
          projectId: selected.id,
          title,
          modelSelection: selection,
          runtimeMode: recent?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: recent?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "server",
        });
        const messageId = MessageId.make(`cli:${NodeCrypto.randomUUID()}`);
        if (text)
          yield* dispatch({
            type: "message.dispatch",
            commandId: commandId(),
            threadId: id,
            messageId,
            text,
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "server",
          });
        yield* Console.log(id);
        if (follow && text) yield* followReply(id, messageId, fetchRecent);
      }),
    ),
  ),
);

const followReply = (
  threadId: ThreadId,
  userMessageId: MessageId,
  fetchRecent: (
    threadId: ThreadId,
  ) => Effect.Effect<OrchestrationV2ThreadBoundedSnapshot, ThreadCliError>,
) =>
  Effect.gen(function* () {
    const printed = new Map<string, string>();
    let completed = false;
    while (!completed) {
      const detail = yield* fetchRecent(threadId);
      const run = detail.projection.runs.find(
        (candidate) => candidate.userMessageId === userMessageId,
      );
      for (const message of detail.projection.messages) {
        if (message.role !== "assistant" || message.runId !== run?.id) continue;
        const prior = printed.get(message.id) ?? "";
        if (message.text.startsWith(prior)) {
          const delta = message.text.slice(prior.length);
          if (delta) yield* Effect.sync(() => process.stdout.write(delta));
        }
        printed.set(message.id, message.text);
      }
      completed =
        run !== undefined &&
        ["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(run.status);
      if (!completed) yield* Effect.sleep(Duration.seconds(1));
    }
    yield* Console.log("");
  });

export const threadCommand = Command.make("thread").pipe(
  Command.withDescription("List, read, create, send, interrupt, and snooze threads."),
  Command.withSubcommands([
    listCommand,
    showCommand,
    newCommand,
    sendCommand,
    interruptCommand,
    snoozeCommand,
    wakeCommand,
  ]),
);
