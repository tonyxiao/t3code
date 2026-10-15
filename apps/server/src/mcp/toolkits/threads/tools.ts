import {
  McpCapabilityUnavailableError,
  ThreadRoutingError,
  EnvironmentId,
  ThreadCreationTargets,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as AgentThreadRouting from "../../../orchestration/AgentThreadRouting.ts";
import * as ThreadCreation from "../../../orchestration/ThreadCreation.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CreateThreadTool = Tool.make("create_thread", {
  description:
    "Create a new thread in the current thread's project, inheriting its provider/model, permissions, interaction mode, branch, and workspace. Supply message to start its first agent turn; omit it to create an empty thread. The new thread has no conversation history from this thread. To target another connection, supply environmentId and projectId from list_thread_targets; the target project supplies the model and workspace defaults. modelSelection can override the target model. A client with both connections must be open.",
  parameters: ThreadCreation.CreateThreadInput,
  success: ThreadCreation.CreateThreadResult,
  failure: Schema.Union([
    McpCapabilityUnavailableError,
    ThreadCreation.ThreadCreationError,
    ThreadRoutingError,
  ]),
  dependencies: [McpInvocationContext.McpInvocationContext, AgentThreadRouting.AgentThreadRouting],
})
  .annotate(Tool.Title, "Create thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const ListTargetsTool = Tool.make("list_thread_targets", {
  description:
    "List connections available for thread creation. Omit environmentId to discover connection ids; pass an environmentId to list that connection's projects, workspace paths, and default models. Remote connections are reached through an open web, desktop, or mobile client with both connections enabled.",
  parameters: Schema.Struct({ environmentId: Schema.optional(EnvironmentId) }),
  success: ThreadCreationTargets,
  failure: Schema.Union([McpCapabilityUnavailableError, ThreadRoutingError]),
  dependencies: [McpInvocationContext.McpInvocationContext, AgentThreadRouting.AgentThreadRouting],
})
  .annotate(Tool.Title, "List thread targets")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(CreateThreadTool, ListTargetsTool);
