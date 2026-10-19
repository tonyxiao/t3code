import { expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectService from "../project/ProjectService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadCreation from "./ThreadCreation.ts";

const projectId = ProjectId.make("project");
const threadId = ThreadId.make("target-thread");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6" };
const project = {
  id: projectId,
  title: "Target",
  workspaceRoot: "/work/target",
  defaultModelSelection: modelSelection,
  scripts: [],
  createdAt: "2026-10-19T00:00:00.000Z",
  updatedAt: "2026-10-19T00:00:00.000Z",
} as const;

it.effect("launches a project thread through v2 with a stable thread id and initial message", () =>
  Effect.gen(function* () {
    const launched: ThreadLaunchService.ThreadLaunchInput[] = [];
    const layer = ThreadCreation.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectService.ProjectService)({
            getShell: () => Effect.succeed(Option.some(project)),
            listShells: () => Effect.succeed([project]),
          }),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: (input) => {
              launched.push(input);
              return Effect.succeed({
                threadId: input.threadId!,
                projection: {} as never,
                resumed: false,
              });
            },
          }),
        ),
      ),
    );
    const service = yield* ThreadCreation.ThreadCreation.pipe(Effect.provide(layer));
    expect(yield* service.projects).toEqual([
      {
        projectId,
        title: "Target",
        workspaceRoot: "/work/target",
        modelSelection,
      },
    ]);
    expect(
      yield* service.createInProject({
        projectId,
        threadId,
        title: "Remote task",
        message: "Start work",
      }),
    ).toEqual({ threadId, turnStarted: true });
    expect(launched[0]).toMatchObject({
      threadId,
      projectId,
      modelSelection,
      workspaceStrategy: { type: "root" },
      initialMessage: { text: "Start work", attachments: [] },
      createdBy: "agent",
      creationSource: "mcp",
    });
    expect(launched[0]?.commandId).toBe(`thread-routing:${threadId}`);
  }),
);

it.effect("rejects a target project without a model before launching", () =>
  Effect.gen(function* () {
    let launched = false;
    const layer = ThreadCreation.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectService.ProjectService)({
            getShell: () =>
              Effect.succeed(Option.some({ ...project, defaultModelSelection: null })),
            listShells: () => Effect.succeed([]),
          }),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: () => {
              launched = true;
              return Effect.die("unexpected launch");
            },
          }),
        ),
      ),
    );
    const service = yield* ThreadCreation.ThreadCreation.pipe(Effect.provide(layer));
    const error = yield* service
      .createInProject({ projectId, threadId, title: "Remote task" })
      .pipe(Effect.flip);
    expect(error.message).toContain("no default model");
    expect(launched).toBe(false);
  }),
);
