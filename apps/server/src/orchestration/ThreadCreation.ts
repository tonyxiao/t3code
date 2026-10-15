import { CommandId, MessageId, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

export const CreateThreadInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
});

export const CreateThreadResult = Schema.Struct({
  threadId: ThreadId,
  turnStarted: Schema.Boolean,
});

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
        modelSelection: thread.modelSelection,
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
            modelSelection: thread.modelSelection,
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

  return ThreadCreation.of({ create });
});

export const layer = Layer.effect(ThreadCreation, make);
