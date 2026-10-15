import * as Effect from "effect/Effect";
import * as ThreadCreation from "../../../orchestration/ThreadCreation.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadsToolkit } from "./tools.ts";

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(
  Effect.gen(function* () {
    const threads = yield* ThreadCreation.ThreadCreation;
    return ThreadsToolkit.of({
      create_thread: (input) =>
        McpInvocationContext.requireMcpCapability("threads").pipe(
          Effect.flatMap((scope) => threads.create(scope.threadId, input)),
        ),
    });
  }),
);
