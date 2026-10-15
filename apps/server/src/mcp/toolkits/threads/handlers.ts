import * as Effect from "effect/Effect";
import * as AgentThreadRouting from "../../../orchestration/AgentThreadRouting.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadsToolkit } from "./tools.ts";

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(
  Effect.gen(function* () {
    const threads = yield* AgentThreadRouting.AgentThreadRouting;
    return ThreadsToolkit.of({
      list_thread_targets: (input) =>
        McpInvocationContext.requireMcpCapability("threads").pipe(
          Effect.flatMap(() => threads.targets(input.environmentId)),
        ),
      create_thread: (input) =>
        McpInvocationContext.requireMcpCapability("threads").pipe(
          Effect.flatMap((scope) => threads.create(scope.threadId, input)),
        ),
    });
  }),
);
