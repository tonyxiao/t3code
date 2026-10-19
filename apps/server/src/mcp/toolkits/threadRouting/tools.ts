import {
  EnvironmentId,
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  ThreadCreationInput,
  ThreadCreationResult,
  ThreadCreationTargets,
  ThreadRoutingError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as AgentThreadRouting from "../../AgentThreadRouting.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  AgentThreadRouting.AgentThreadRouting,
  ThreadManagementService.ThreadManagementService,
];

const ListTargetsTool = Tool.make("list_thread_targets", {
  description:
    "List connections available for thread creation. Omit environmentId to discover connections; pass one to list its projects and default models. Another connection needs an open client connected to both servers.",
  parameters: Schema.Struct({ environmentId: Schema.optional(EnvironmentId) }),
  success: ThreadCreationTargets,
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    ThreadRoutingError,
    OrchestratorMcpFailure,
  ]),
  dependencies,
})
  .annotate(Tool.Title, "List thread targets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const CreateThreadTool = Tool.make("create_thread", {
  description:
    "Create a top-level thread in a chosen project or another connected T3 environment. Use list_thread_targets for environmentId and projectId. Supply message to start the first turn; omit it for an empty thread. The target project supplies the default model and workspace. For a related thread in this checkout, use create_threads or t3_thread_launch instead.",
  parameters: ThreadCreationInput,
  success: ThreadCreationResult,
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    ThreadRoutingError,
    OrchestratorMcpFailure,
  ]),
  dependencies,
})
  .annotate(Tool.Title, "Create thread in a connection")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ThreadRoutingToolkit = Toolkit.make(ListTargetsTool, CreateThreadTool);
