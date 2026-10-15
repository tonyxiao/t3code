import {
  ThreadRoutingError,
  ThreadCreationProjects,
  ThreadCreationResult,
  type ThreadRoutingEvent,
  type ThreadRoutingHost,
  type ThreadRoutingRequest,
  type ThreadRoutingResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Cause from "effect/Cause";

type Request =
  | Omit<Extract<ThreadRoutingRequest, { operation: "projects" }>, "requestId">
  | Omit<Extract<ThreadRoutingRequest, { operation: "create" }>, "requestId">;
type Response = typeof ThreadRoutingResponse.Type;
type Host = typeof ThreadRoutingHost.Type;
type Result = NonNullable<Response["result"]>;
type Client = {
  host: Host;
  sessionId: string;
  queue: Queue.Queue<ThreadRoutingRequest, Cause.Done>;
};

export class ThreadRoutingBroker extends Context.Service<
  ThreadRoutingBroker,
  {
    readonly connect: (
      sessionId: string,
      host: Host,
    ) => Effect.Effect<Stream.Stream<ThreadRoutingEvent>>;
    readonly respond: (
      sessionId: string,
      response: Response,
    ) => Effect.Effect<void, ThreadRoutingError>;
    readonly connections: Effect.Effect<Host["connections"]>;
    readonly invoke: (request: Request) => Effect.Effect<Result, ThreadRoutingError>;
  }
>()("t3/orchestration/ThreadRoutingBroker") {}

const decodeProjects = Schema.decodeUnknownEffect(ThreadCreationProjects);
const decodeCreationResult = Schema.decodeUnknownEffect(ThreadCreationResult);

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const clients = new Set<Client>();
  const pending = new Map<
    string,
    { client: Client; request: Request; deferred: Deferred.Deferred<Result, ThreadRoutingError> }
  >();
  const failure = (request: Request, message: string) =>
    new ThreadRoutingError({
      message,
      environmentId: request.environmentId,
      ...(request.operation === "create" ? { threadId: request.input.threadId } : {}),
    });
  const remove = (client: Client) =>
    Effect.gen(function* () {
      clients.delete(client);
      for (const [id, entry] of pending) {
        if (entry.client !== client) continue;
        pending.delete(id);
        yield* Deferred.fail(
          entry.deferred,
          failure(
            entry.request,
            "The routing client disconnected. A submitted creation may have completed; check the returned thread id before retrying.",
          ),
        );
      }
      yield* Queue.end(client.queue);
    });
  return ThreadRoutingBroker.of({
    connections: Effect.sync(() => [
      ...new Map(
        [...clients].flatMap(({ host }) =>
          host.connections.map((connection) => [connection.environmentId, connection] as const),
        ),
      ).values(),
    ]),
    connect: (sessionId, host) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ThreadRoutingRequest, Cause.Done>();
        const client: Client = { sessionId, host, queue };
        return Stream.unwrap(
          Effect.acquireRelease(
            Effect.sync(() => {
              clients.add(client);
              return client;
            }),
            remove,
          ).pipe(
            Effect.map(() =>
              Stream.concat(
                Stream.succeed({ operation: "ready" } as const),
                Stream.fromQueue(queue),
              ),
            ),
          ),
        );
      }),
    respond: (sessionId, response) =>
      Effect.gen(function* () {
        const entry = pending.get(response.requestId);
        if (
          !entry ||
          entry.client.sessionId !== sessionId ||
          entry.client.host.connectionId !== response.connectionId
        ) {
          return yield* new ThreadRoutingError({
            message: "Unknown thread-routing response or client.",
          });
        }
        pending.delete(response.requestId);
        if (response.error !== undefined) {
          yield* Deferred.fail(entry.deferred, failure(entry.request, response.error));
          return;
        }
        const decoded =
          entry.request.operation === "projects"
            ? decodeProjects(response.result).pipe(Effect.map((result): Result => result))
            : decodeCreationResult(response.result).pipe(Effect.map((result): Result => result));
        const result = yield* decoded.pipe(
          Effect.mapError(() =>
            failure(entry.request, "The routing client returned an invalid result."),
          ),
          Effect.tapError((error) => Deferred.fail(entry.deferred, error)),
        );
        if (
          entry.request.operation === "create" &&
          (!("threadId" in result) || result.threadId !== entry.request.input.threadId)
        ) {
          const error = failure(
            entry.request,
            "The routing client returned a different thread id.",
          );
          yield* Deferred.fail(entry.deferred, error);
          return yield* error;
        }
        yield* Deferred.succeed(entry.deferred, result);
      }),
    invoke: (request) =>
      Effect.gen(function* () {
        // Pick one bridge and never retry a mutation on another client.
        const client = [...clients]
          .toReversed()
          .find(({ host }) =>
            host.connections.some(
              (connection) => connection.environmentId === request.environmentId,
            ),
          );
        if (!client)
          return yield* failure(
            request,
            "No connected client can route to this environment. Open a client with both connections enabled.",
          );
        const requestId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
        const deferred = yield* Deferred.make<Result, ThreadRoutingError>();
        return yield* Effect.acquireUseRelease(
          Effect.sync(() => pending.set(requestId, { client, request, deferred })),
          () =>
            Queue.offer(client.queue, { ...request, requestId }).pipe(
              Effect.andThen(Deferred.await(deferred)),
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () =>
                  Effect.fail(
                    failure(
                      request,
                      "Thread routing timed out. A submitted creation may have completed; check the returned thread id before retrying.",
                    ),
                  ),
              }),
            ),
          () =>
            Effect.sync(() => {
              pending.delete(requestId);
            }),
        );
      }),
  });
});
export const layer = Layer.effect(ThreadRoutingBroker, make);
