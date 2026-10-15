import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { ThreadsToolkitHandlersLive } from "../mcp/toolkits/threads/handlers.ts";
import { ThreadsToolkit } from "../mcp/toolkits/threads/tools.ts";
import * as ThreadCreation from "./ThreadCreation.ts";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const source: OrchestrationThreadShell = {
  id: ThreadId.make("source"),
  projectId: ProjectId.make("project"),
  title: "Source",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature",
  worktreePath: "/workspace/feature",
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const harness = Effect.fn("threadCreationHarness")(function* (
  options: { missing?: boolean; archived?: boolean; rejectStart?: boolean; deny?: boolean } = {},
) {
  const commands: OrchestrationCommand[] = [];
  let counter = 0;
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () =>
        Effect.succeed(
          options.missing
            ? Option.none()
            : Option.some({
                ...source,
                archivedAt: options.archived ? source.createdAt : null,
              }),
        ),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) => {
        if (options.rejectStart && command.type === "thread.turn.start") {
          return Effect.fail(
            new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Rejected turn",
            }),
          );
        }
        commands.push(command);
        return Effect.succeed({ sequence: commands.length });
      },
    }),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(++counter),
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
  );
  const toolkit = yield* ThreadsToolkit.pipe(
    Effect.provide(
      ThreadsToolkitHandlersLive.pipe(
        Layer.provide(ThreadCreation.layer),
        Layer.provide(dependencies),
      ),
    ),
  );
  const call = (input: typeof ThreadCreation.CreateThreadInput.Type) =>
    toolkit.handle("create_thread", input).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map((results) => results.at(-1)!.result),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        threadId: source.id,
        providerInstanceId: source.modelSelection.instanceId,
        providerSessionId: "provider-session",
        capabilities: new Set<McpInvocationContext.McpCapability>(options.deny ? [] : ["threads"]),
        issuedAt: 0,
      }),
      Effect.provide(ThreadCreation.layer.pipe(Layer.provide(dependencies))),
    );
  return { commands, call };
});

describe("thread creation through MCP", () => {
  it.effect(
    "creates an empty thread in the caller's workspace with its model and permissions",
    () =>
      Effect.gen(function* () {
        const { call, commands } = yield* harness();
        const result = yield* call({ title: "Related work" });
        expect(result).toMatchObject({ turnStarted: false });
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          type: "thread.create",
          title: "Related work",
          projectId: source.projectId,
          modelSelection: source.modelSelection,
          runtimeMode: source.runtimeMode,
          interactionMode: source.interactionMode,
          branch: source.branch,
          worktreePath: source.worktreePath,
        });
        expect(commands.find((command) => command.type === "thread.create")?.threadId).not.toBe(
          source.id,
        );
      }),
  );

  it.effect("starts the first turn only after creation and returns the created thread id", () =>
    Effect.gen(function* () {
      const { call, commands } = yield* harness();
      const result = yield* call({ title: "Related work", message: "Investigate the issue" });
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.turn.start",
      ]);
      expect(result).toEqual({
        threadId: commands.find((command) => command.type === "thread.create")?.threadId,
        turnStarted: true,
      });
      expect(commands[1]).toMatchObject({
        threadId: commands.find((command) => command.type === "thread.create")?.threadId,
        message: { role: "user", text: "Investigate the issue", attachments: [] },
      });
      expect(commands[0]?.commandId).not.toBe(commands[1]?.commandId);
    }),
  );

  for (const options of [{ deny: true }, { missing: true }, { archived: true }]) {
    it.effect(`rejects unavailable source or capability: ${JSON.stringify(options)}`, () =>
      Effect.gen(function* () {
        const { call, commands } = yield* harness(options);
        const error = yield* call({ title: "Related work" }).pipe(Effect.flip);
        expect(error._tag).toBe(
          options.deny ? "McpCapabilityUnavailableError" : "ThreadCreationError",
        );
        expect(commands).toEqual([]);
      }),
    );
  }

  it.effect("reports the existing new thread when its first turn fails", () =>
    Effect.gen(function* () {
      const { call, commands } = yield* harness({ rejectStart: true });
      const error = yield* call({ title: "Related work", message: "Investigate" }).pipe(
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: "ThreadCreationError",
        sourceThreadId: source.id,
        createdThreadId: commands.find((command) => command.type === "thread.create")?.threadId,
      });
      expect(error.message).toContain("Do not recreate it");
      expect(commands).toHaveLength(1);
    }),
  );
});
