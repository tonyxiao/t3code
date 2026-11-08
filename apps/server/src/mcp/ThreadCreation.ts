import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ThreadRoutingError,
  type ProjectThreadCreationInput,
  type ThreadCreationProjects,
  type ThreadCreationResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class ThreadCreation extends Context.Service<
  ThreadCreation,
  {
    readonly projects: Effect.Effect<typeof ThreadCreationProjects.Type, ThreadRoutingError>;
    readonly createInProject: (
      input: typeof ProjectThreadCreationInput.Type,
    ) => Effect.Effect<typeof ThreadCreationResult.Type, ThreadRoutingError>;
  }
>()("t3/mcp/ThreadCreation") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const launcher = yield* ThreadLaunchService.ThreadLaunchService;
  const projectList = projects.listShells().pipe(
    Effect.map((items) =>
      items.map((project) => ({
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        modelSelection: project.defaultModelSelection,
      })),
    ),
    Effect.mapError(
      (cause) => new ThreadRoutingError({ message: "Could not list target projects.", cause }),
    ),
  );
  const createInProject = Effect.fn("ThreadCreation.createInProject")(function* (
    input: typeof ProjectThreadCreationInput.Type,
  ) {
    const project = yield* projects
      .getShell(input.projectId)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadRoutingError({ message: "Could not read the target project.", cause }),
        ),
      );
    if (Option.isNone(project)) {
      return yield* new ThreadRoutingError({
        message: "The target project was not found.",
        threadId: input.threadId,
      });
    }
    const modelSelection = input.modelSelection ?? project.value.defaultModelSelection;
    if (modelSelection === null) {
      return yield* new ThreadRoutingError({
        message: "The target project has no default model. Select a model explicitly.",
        threadId: input.threadId,
      });
    }
    const result = yield* launcher
      .launch({
        commandId: CommandId.make(`thread-routing:${input.threadId}`),
        threadId: input.threadId,
        projectId: input.projectId,
        title: input.title,
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        workspaceStrategy: { type: "root" },
        ...(input.message === undefined
          ? {}
          : {
              initialMessage: {
                messageId: MessageId.make(`thread-routing:${input.threadId}`),
                text: input.message,
                attachments: [],
              },
            }),
        createdBy: "agent",
        creationSource: "mcp",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ThreadRoutingError({
              message: "The target server could not create the thread.",
              threadId: input.threadId,
              cause,
            }),
        ),
      );
    return { threadId: result.threadId, turnStarted: input.message !== undefined };
  });
  return ThreadCreation.of({ projects: projectList, createInProject });
});

export const layer = Layer.effect(ThreadCreation, make);
