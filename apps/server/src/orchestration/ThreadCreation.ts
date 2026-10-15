import {
  CommandId,
  MessageId,
  ThreadId,
  ThreadCreationInput,
  ThreadCreationResult,
  ThreadCreationProjects,
  ProjectThreadCreationInput,
  ThreadRoutingError,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

export const CreateThreadInput = ThreadCreationInput;
export const CreateThreadResult = ThreadCreationResult;

export class ThreadCreationError extends Schema.TaggedError<ThreadCreationError>()(
  "ThreadCreationError",
  { sourceThreadId: ThreadId, createdThreadId: Schema.optional(ThreadId), cause: Schema.Defect() },
) {
  override get message(): string {
    return this.createdThreadId === undefined
      ? `Failed to create a thread from ${this.sourceThreadId}.`
      : `Created thread ${this.createdThreadId}, but failed to start its first turn. Do not recreate it.`;
  }
}

const isThreadCreationError = Schema.is(ThreadCreationError);

export class ThreadCreation extends Context.Service<
  ThreadCreation,
  {
    readonly projects: Effect.Effect<typeof ThreadCreationProjects.Type, ThreadRoutingError>;
    readonly createInProject: (
      input: typeof ProjectThreadCreationInput.Type,
    ) => Effect.Effect<typeof ThreadCreationResult.Type, ThreadRoutingError>;
    readonly create: (
      sourceThreadId: ThreadId,
      input: typeof CreateThreadInput.Type,
    ) => Effect.Effect<typeof CreateThreadResult.Type, ThreadCreationError>;
  }
>()("t3/orchestration/ThreadCreation") {}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const create = Effect.fn("ThreadCreation.create")(function* (
    sourceThreadId: ThreadId,
    input: typeof CreateThreadInput.Type,
  ) {
    return yield* Effect.gen(function* () {
      const source = yield* snapshots.getThreadShellById(sourceThreadId);
      if (Option.isNone(source) || source.value.archivedAt !== null) {
        return yield* new ThreadCreationError({
          sourceThreadId,
          cause: "Source thread is unavailable.",
        });
      }
      const thread = source.value;
      const threadId = ThreadId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
        threadId,
        projectId: thread.projectId,
        title: input.title,
        modelSelection: input.modelSelection ?? thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        createdAt,
      });
      if (input.message !== undefined) {
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
            threadId,
            message: {
              messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
              role: "user",
              text: input.message,
              attachments: [],
            },
            modelSelection: input.modelSelection ?? thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ThreadCreationError({ sourceThreadId, createdThreadId: threadId, cause }),
            ),
          );
      }
      return { threadId, turnStarted: input.message !== undefined };
    }).pipe(
      Effect.mapError((cause) =>
        isThreadCreationError(cause) ? cause : new ThreadCreationError({ sourceThreadId, cause }),
      ),
    );
  });

  const projects = snapshots.getShellSnapshot().pipe(
    Effect.map((snapshot) => {
      const recentModels = new Map(
        snapshot.threads
          .filter((thread) => thread.archivedAt === null)
          .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt))
          .map((thread) => [thread.projectId, thread.modelSelection]),
      );
      return snapshot.projects.map((project) => ({
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        modelSelection: project.defaultModelSelection ?? recentModels.get(project.id) ?? null,
      }));
    }),
    Effect.mapError(
      () =>
        new ThreadRoutingError({ message: "Could not read projects in the target environment." }),
    ),
  );
  const createInProject = Effect.fn("ThreadCreation.createInProject")(function* (
    input: typeof ProjectThreadCreationInput.Type,
  ) {
    const project = (yield* projects).find((entry) => entry.projectId === input.projectId);
    if (!project)
      return yield* new ThreadRoutingError({ message: "The target project does not exist." });
    const modelSelection = input.modelSelection ?? project.modelSelection;
    if (!modelSelection)
      return yield* new ThreadRoutingError({
        message: "The target project has no default or recent model. Supply modelSelection.",
      });
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const fail = () =>
      new ThreadRoutingError({
        message: "Thread creation failed. Check the returned thread id before retrying.",
        threadId: input.threadId,
      });
    yield* engine
      .dispatch({
        type: "thread.create",
        commandId: CommandId.make(`agent-create:${input.threadId}`),
        threadId: input.threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt,
      })
      .pipe(Effect.mapError(fail));
    if (input.message !== undefined) {
      yield* engine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`agent-start:${input.threadId}`),
          threadId: input.threadId,
          message: {
            messageId: MessageId.make(`agent-message:${input.threadId}`),
            role: "user",
            text: input.message,
            attachments: [],
          },
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt,
        })
        .pipe(Effect.mapError(fail));
    }
    return {
      threadId: input.threadId,
      projectId: input.projectId,
      turnStarted: input.message !== undefined,
    };
  });

  return ThreadCreation.of({ create, projects, createInProject });
});

export const layer = Layer.effect(ThreadCreation, make);
