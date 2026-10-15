import { McpCapabilityUnavailableError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as ThreadCreation from "../../../orchestration/ThreadCreation.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CreateThreadTool = Tool.make("create_thread", {
  description:
    "Create a new thread in the current thread's project, inheriting its provider/model, permissions, interaction mode, branch, and workspace. Supply message to start its first agent turn; omit it to create an empty thread. The new thread has no conversation history from this thread.",
  parameters: ThreadCreation.CreateThreadInput,
  success: ThreadCreation.CreateThreadResult,
  failure: Schema.Union([McpCapabilityUnavailableError, ThreadCreation.ThreadCreationError]),
  dependencies: [McpInvocationContext.McpInvocationContext, ThreadCreation.ThreadCreation],
})
  .annotate(Tool.Title, "Create thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ThreadsToolkit = Toolkit.make(CreateThreadTool);
