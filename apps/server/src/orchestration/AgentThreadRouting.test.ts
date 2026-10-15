import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentThreadRouting from "./AgentThreadRouting.ts";
import * as ThreadRoutingBroker from "./ThreadRoutingBroker.ts";
import * as ThreadCreation from "./ThreadCreation.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const project: OrchestrationProjectShell = {
  id: ProjectId.make("remote-project"),
  title: "Remote project",
  workspaceRoot: "/remote/project",
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "claude-opus",
  },
  scripts: [],
  repositoryIdentity: null,
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

const harness = Effect.fn("routingHarness")(function* (
  defaultModel = project.defaultModelSelection,
) {
  const commands: OrchestrationCommand[] = [];
  const target = yield* ThreadCreation.ThreadCreation.pipe(
    Effect.provide(
      ThreadCreation.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionSnapshotQuery)({
              getShellSnapshot: () =>
                Effect.succeed({
                  snapshotSequence: 0,
                  projects: [{ ...project, defaultModelSelection: defaultModel }],
                  threads: [],
                  updatedAt: project.updatedAt,
                }),
            }),
            Layer.mock(OrchestrationEngineService)({
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return { sequence: commands.length };
                }),
            }),
            NodeServices.layer,
          ),
        ),
      ),
    ),
  );
  return { target, commands };
});
const dependencies = Layer.mergeAll(
  ThreadRoutingBroker.layer,
  Layer.mock(ThreadCreation.ThreadCreation)({}),
  Layer.mock(ServerEnvironment.ServerEnvironment)({
    getEnvironmentId: Effect.succeed(local),
    getDescriptor: Effect.succeed({
      environmentId: local,
      label: "Local",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "test",
      capabilities: { repositoryIdentity: false },
    }),
  }),
).pipe(Layer.provideMerge(NodeServices.layer));
const testLayer = AgentThreadRouting.layer.pipe(Layer.provideMerge(dependencies));

it.effect("discovers a remote project and creates in that environment using its own defaults", () =>
  Effect.gen(function* () {
    const routing = yield* AgentThreadRouting.AgentThreadRouting;
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    const { target, commands } = yield* harness();
    const ready = yield* Deferred.make<void>();
    const events = yield* broker.connect("session", {
      connectionId: "bridge",
      connections: [{ environmentId: remote, label: "Remote" }],
    });
    yield* events.pipe(
      Stream.runForEach((event) =>
        event.operation === "ready"
          ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid)
          : Effect.gen(function* () {
              const result =
                event.operation === "projects"
                  ? yield* target.projects
                  : yield* target.createInProject(event.input);
              yield* broker.respond("session", {
                connectionId: "bridge",
                requestId: event.requestId,
                result,
              });
            }),
      ),
      Effect.forkChild,
    );
    yield* Deferred.await(ready);
    expect((yield* routing.targets()).connections).toEqual(
      expect.arrayContaining([
        { environmentId: remote, label: "Remote" },
        { environmentId: local, label: "Local" },
      ]),
    );
    const targets = yield* routing.targets(remote);
    expect(targets.projects).toEqual([
      {
        projectId: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        modelSelection: project.defaultModelSelection,
      },
    ]);
    const result = yield* routing.create(ThreadId.make("source"), {
      environmentId: remote,
      projectId: project.id,
      title: "Remote task",
      message: "Do the work",
    });
    expect(result).toMatchObject({
      environmentId: remote,
      projectId: project.id,
      turnStarted: true,
    });
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      type: "thread.create",
      projectId: project.id,
      modelSelection: project.defaultModelSelection,
      branch: null,
      worktreePath: null,
    });
    expect(commands[1]).toMatchObject({
      type: "thread.turn.start",
      threadId: result.threadId,
      message: { text: "Do the work" },
      modelSelection: project.defaultModelSelection,
    });
  }).pipe(Effect.provide(testLayer)),
);

it.effect("requires an explicit target project rather than falling back to the source", () =>
  Effect.gen(function* () {
    const routing = yield* AgentThreadRouting.AgentThreadRouting;
    const error = yield* routing
      .create(ThreadId.make("source"), { environmentId: remote, title: "Work" })
      .pipe(Effect.flip);
    expect(error.message).toContain("projectId is required");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects missing projects before dispatch", () =>
  Effect.gen(function* () {
    const { target, commands } = yield* harness();
    const error = yield* target
      .createInProject({
        projectId: ProjectId.make("missing"),
        title: "Work",
        threadId: ThreadId.make("new"),
      })
      .pipe(Effect.flip);
    expect(error.message).toContain("does not exist");
    expect(commands).toEqual([]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("requires a target model when no default exists and accepts an explicit override", () =>
  Effect.gen(function* () {
    const { target, commands } = yield* harness(null);
    const input = {
      projectId: project.id,
      title: "Work",
      threadId: ThreadId.make("explicit-model"),
    };
    const error = yield* target.createInProject(input).pipe(Effect.flip);
    expect(error.message).toContain("no default or recent model");
    expect(commands).toEqual([]);
    const modelSelection = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "custom-model",
    };
    yield* target.createInProject({ ...input, modelSelection });
    expect(commands[0]).toMatchObject({ modelSelection });
  }).pipe(Effect.provide(NodeServices.layer)),
);
