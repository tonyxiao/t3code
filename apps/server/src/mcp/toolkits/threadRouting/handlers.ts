import * as Effect from "effect/Effect";
import * as AgentThreadRouting from "../../AgentThreadRouting.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ThreadRoutingToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ThreadRoutingToolkit, {
  list_thread_targets: McpToolAccess.reads(({ environmentId }) =>
    Effect.flatMap(AgentThreadRouting.AgentThreadRouting, (service) =>
      service.targets(environmentId),
    ),
  ),
  create_thread: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(AgentThreadRouting.AgentThreadRouting, (service) => service.create(input)),
  ),
});
