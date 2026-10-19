import {
  ThreadId,
  ThreadRoutingError,
  ThreadCreationProjects,
  ThreadCreationResult,
  type EnvironmentId,
  type ThreadCreationInput,
  type ThreadCreationTargets,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadCreation from "./ThreadCreation.ts";
import * as ThreadRoutingBroker from "./ThreadRoutingBroker.ts";

const decodeProjects = Schema.decodeUnknownEffect(ThreadCreationProjects);
const decodeResult = Schema.decodeUnknownEffect(ThreadCreationResult);

export class AgentThreadRouting extends Context.Service<
  AgentThreadRouting,
  {
    readonly targets: (
      environmentId?: EnvironmentId,
    ) => Effect.Effect<typeof ThreadCreationTargets.Type, ThreadRoutingError>;
    readonly create: (
      input: typeof ThreadCreationInput.Type,
    ) => Effect.Effect<typeof ThreadCreationResult.Type, ThreadRoutingError>;
  }
>()("t3/mcp/AgentThreadRouting") {}

const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const creation = yield* ThreadCreation.ThreadCreation;
  const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* environment.getEnvironmentId;
  const invalid = () => new ThreadRoutingError({ message: "Invalid thread-routing result." });

  return AgentThreadRouting.of({
    targets: (target) =>
      Effect.gen(function* () {
        const descriptor = yield* environment.getDescriptor;
        const connections = [
          ...new Map(
            [...(yield* broker.connections), { environmentId, label: descriptor.label }].map(
              (entry) => [entry.environmentId, entry] as const,
            ),
          ).values(),
        ];
        if (target === undefined) return { connections };
        const projects =
          target === environmentId
            ? yield* creation.projects
            : yield* broker
                .invoke({ operation: "projects", environmentId: target })
                .pipe(
                  Effect.flatMap((result) => decodeProjects(result).pipe(Effect.mapError(invalid))),
                );
        return { connections, projects };
      }),
    create: (input) =>
      Effect.gen(function* () {
        if (input.projectId === undefined) {
          return yield* new ThreadRoutingError({
            message: "projectId is required. Use list_thread_targets to discover projects.",
          });
        }
        const target = input.environmentId ?? environmentId;
        const request = {
          projectId: input.projectId,
          title: input.title,
          message: input.message,
          modelSelection: input.modelSelection,
          threadId: ThreadId.make(yield* crypto.randomUUIDv4().pipe(Effect.orDie)),
        };
        const result =
          target === environmentId
            ? yield* creation.createInProject(request)
            : yield* broker
                .invoke({ operation: "create", environmentId: target, input: request })
                .pipe(
                  Effect.flatMap((value) => decodeResult(value).pipe(Effect.mapError(invalid))),
                );
        return { ...result, environmentId: target, projectId: input.projectId };
      }),
  });
});

export const layer = Layer.effect(AgentThreadRouting, make);
