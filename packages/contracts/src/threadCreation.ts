import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const ThreadCreationInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  environmentId: Schema.optional(EnvironmentId),
  projectId: Schema.optional(ProjectId),
  modelSelection: Schema.optional(ModelSelection),
});
export const ProjectThreadCreationInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
  projectId: ProjectId,
  modelSelection: Schema.optional(ModelSelection),
  threadId: ThreadId,
});
export const ThreadCreationResult = Schema.Struct({
  threadId: ThreadId,
  turnStarted: Schema.Boolean,
  environmentId: Schema.optional(EnvironmentId),
  projectId: Schema.optional(ProjectId),
});
export const ThreadCreationProject = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  workspaceRoot: Schema.String,
  modelSelection: Schema.NullOr(ModelSelection),
});
export const ThreadCreationProjects = Schema.Array(ThreadCreationProject);
export const ThreadCreationConnection = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
});
export const ThreadCreationTargets = Schema.Struct({
  connections: Schema.Array(ThreadCreationConnection),
  projects: Schema.optional(ThreadCreationProjects),
});
export class ThreadRoutingError extends Schema.TaggedError<ThreadRoutingError>()(
  "ThreadRoutingError",
  {
    message: Schema.String,
    environmentId: Schema.optional(EnvironmentId),
    threadId: Schema.optional(ThreadId),
  },
) {}

export const ThreadRoutingHost = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  connections: Schema.Array(ThreadCreationConnection),
});
export const ThreadRoutingRequest = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("projects"),
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
  }),
  Schema.Struct({
    operation: Schema.Literal("create"),
    requestId: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    input: ProjectThreadCreationInput,
  }),
]);
export type ThreadRoutingRequest = typeof ThreadRoutingRequest.Type;
export const ThreadRoutingEvent = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("ready") }),
  ThreadRoutingRequest,
]);
export type ThreadRoutingEvent = typeof ThreadRoutingEvent.Type;
export const ThreadRoutingResponse = Schema.Struct({
  connectionId: TrimmedNonEmptyString,
  requestId: TrimmedNonEmptyString,
  result: Schema.optional(Schema.Union([ThreadCreationProjects, ThreadCreationResult])),
  error: Schema.optional(Schema.String),
});
