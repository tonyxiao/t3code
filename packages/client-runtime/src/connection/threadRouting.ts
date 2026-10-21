import {
  WS_METHODS,
  ThreadRoutingError,
  type EnvironmentId,
  type ThreadRoutingRequest,
  type ThreadRoutingHost,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Schema from "effect/Schema";
import { EnvironmentRegistry } from "./registry.ts";
import { EnvironmentSupervisor } from "./supervisor.ts";
import * as EnvironmentRpc from "../rpc/client.ts";

const isRoutingError = Schema.is(ThreadRoutingError);

/** Routes through the client's existing authenticated sessions; credentials never leave the client. */
export const executeThreadRoutingRequest = Effect.fn("connection.executeThreadRoutingRequest")(
  function* (request: ThreadRoutingRequest) {
    const registry = yield* EnvironmentRegistry;
    const entry = (yield* SubscriptionRef.get(registry.entries)).get(request.environmentId);
    if (!entry?.enabled)
      return yield* new ThreadRoutingError({
        message: "The target connection is disabled or was removed.",
      });
    const state = yield* registry.state(request.environmentId);
    if (state.phase !== "connected")
      return yield* new ThreadRoutingError({
        message: "The target connection is offline. Connect it before creating a thread.",
      });
    return yield* registry.run(
      request.environmentId,
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        const session = yield* SubscriptionRef.get(supervisor.session);
        if (Option.isNone(session))
          return yield* new ThreadRoutingError({ message: "The target connection disconnected." });
        const config = yield* session.value.initialConfig;
        if (config.environment.capabilities.agentThreadRouting !== true) {
          return yield* new ThreadRoutingError({
            message: "Update the target server to support agent thread creation.",
          });
        }
        return request.operation === "projects"
          ? yield* EnvironmentRpc.request(WS_METHODS.threadCreationProjects, {})
          : yield* EnvironmentRpc.request(WS_METHODS.threadCreationCreate, request.input);
      }),
    );
  },
);

export const watchThreadRouting = Effect.fn("connection.watchThreadRouting")(function* () {
  const registry = yield* EnvironmentRegistry;
  const crypto = yield* Crypto.Crypto;
  const sourceStream = (
    environmentId: EnvironmentId,
    connections: (typeof ThreadRoutingHost.Type)["connections"],
  ) =>
    registry.followStream(
      environmentId,
      Stream.unwrap(
        Effect.gen(function* () {
          const supervisor = yield* EnvironmentSupervisor;
          return SubscriptionRef.changes(supervisor.session).pipe(
            Stream.switchMap((session) => {
              if (Option.isNone(session)) return Stream.empty;
              const active = session.value;
              return Stream.unwrap(
                active.initialConfig.pipe(
                  Effect.flatMap((config) =>
                    Effect.gen(function* () {
                      if (config.environment.capabilities.agentThreadRouting !== true)
                        return Stream.empty;
                      const connectionId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
                      return active.client[WS_METHODS.threadRoutingConnect]({
                        connectionId,
                        connections,
                      }).pipe(
                        Stream.mapEffect(
                          (request) =>
                            request.operation === "ready"
                              ? Effect.void
                              : executeThreadRoutingRequest(request).pipe(
                                  Effect.match({
                                    onSuccess: (result) => ({
                                      connectionId,
                                      requestId: request.requestId,
                                      result,
                                    }),
                                    onFailure: (error) => ({
                                      connectionId,
                                      requestId: request.requestId,
                                      error: isRoutingError(error)
                                        ? error.message
                                        : "The target connection rejected the request. Check its connection and permissions.",
                                    }),
                                  }),
                                  // Reply on the exact source session that delivered the request.
                                  Effect.flatMap((response) =>
                                    active.client[WS_METHODS.threadRoutingRespond](response),
                                  ),
                                  Effect.catch((error) =>
                                    Effect.logWarning(
                                      "Could not deliver thread-routing response.",
                                      {
                                        error,
                                      },
                                    ),
                                  ),
                                ),
                          { concurrency: 4 },
                        ),
                      );
                    }),
                  ),
                ),
              ).pipe(
                Stream.catch((error) =>
                  Stream.fromEffect(
                    Effect.logWarning("Thread routing is unavailable on this connection.", {
                      error,
                    }),
                  ),
                ),
              );
            }),
          );
        }),
      ),
    );
  yield* SubscriptionRef.changes(registry.entries).pipe(
    Stream.switchMap((entries) => {
      const enabled = [...entries.values()].filter((entry) => entry.enabled);
      if (enabled.length === 0) return Stream.empty;
      return Stream.zipLatestAll(
        ...enabled.map(({ target }) =>
          registry.stateChanges(target.environmentId).pipe(
            Stream.map((state) =>
              state.phase === "connected"
                ? {
                    environmentId: target.environmentId,
                    label: target.label,
                  }
                : null,
            ),
            Stream.changesWith((a, b) => a?.environmentId === b?.environmentId),
          ),
        ),
      ).pipe(
        Stream.switchMap((states) => {
          const connections = states.filter((entry) => entry !== null);
          return Stream.mergeAll(
            connections.map(({ environmentId }) => sourceStream(environmentId, connections)),
            { concurrency: "unbounded" },
          );
        }),
      );
    }),
    Stream.runDrain,
  );
});
