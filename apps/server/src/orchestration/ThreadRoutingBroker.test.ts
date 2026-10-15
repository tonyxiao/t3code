import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId, type ThreadRoutingEvent } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as ThreadRoutingBroker from "./ThreadRoutingBroker.ts";

const env = EnvironmentId.make("remote");
const request = {
  operation: "create" as const,
  environmentId: env,
  input: {
    projectId: ProjectId.make("target-project"),
    title: "Related work",
    threadId: ThreadId.make("new-thread"),
  },
};
const testLayer = ThreadRoutingBroker.layer.pipe(Layer.provide(NodeServices.layer));
const host = {
  connectionId: "client-connection",
  connections: [{ environmentId: env, label: "Remote" }],
};
const startHost = Effect.fn("startHost")(function* <E>(
  handle: (event: Exclude<ThreadRoutingEvent, { operation: "ready" }>) => Effect.Effect<void, E>,
) {
  const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
  const ready = yield* Deferred.make<void>();
  const events = yield* broker.connect("session", host);
  const fiber = yield* events.pipe(
    Stream.runForEach((event) =>
      event.operation === "ready"
        ? Deferred.succeed(ready, undefined).pipe(Effect.asVoid)
        : handle(event),
    ),
    Effect.forkChild,
  );
  yield* Deferred.await(ready);
  return fiber;
});

it.effect("routes a creation once and rejects responses from another client", () =>
  Effect.gen(function* () {
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    let delivered = 0;
    yield* startHost((event) =>
      Effect.gen(function* () {
        delivered++;
        expect(event).toMatchObject(request);
        const response = {
          connectionId: host.connectionId,
          requestId: event.requestId,
          result: { threadId: request.input.threadId, turnStarted: false },
        };
        const wrongSession = yield* broker.respond("other-session", response).pipe(Effect.flip);
        expect(wrongSession._tag).toBe("ThreadRoutingError");
        const wrongConnection = yield* broker
          .respond("session", { ...response, connectionId: "other-connection" })
          .pipe(Effect.flip);
        expect(wrongConnection._tag).toBe("ThreadRoutingError");
        yield* broker.respond("session", response);
        const duplicate = yield* broker.respond("session", response).pipe(Effect.flip);
        expect(duplicate._tag).toBe("ThreadRoutingError");
      }),
    );
    expect(yield* broker.invoke(request)).toEqual({
      threadId: request.input.threadId,
      turnStarted: false,
    });
    expect(delivered).toBe(1);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("fails immediately when no client knows the target", () =>
  Effect.gen(function* () {
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    const error = yield* broker.invoke(request).pipe(Effect.flip);
    expect(error.threadId).toBe(request.input.threadId);
    expect(error.message).toContain("No connected client");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("rejects a malformed result and releases the waiting request", () =>
  Effect.gen(function* () {
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    yield* startHost((event) =>
      broker
        .respond("session", {
          connectionId: host.connectionId,
          requestId: event.requestId,
          result: [],
        })
        .pipe(Effect.ignore),
    );
    const error = yield* broker.invoke(request).pipe(Effect.flip);
    expect(error.message).toContain("invalid result");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("disconnects a bridge without replaying its in-flight creation", () =>
  Effect.gen(function* () {
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    const delivered = yield* Deferred.make<void>();
    const hostFiber = yield* startHost(() =>
      Deferred.succeed(delivered, undefined).pipe(Effect.asVoid),
    );
    const call = yield* broker.invoke(request).pipe(Effect.flip, Effect.forkChild);
    yield* Deferred.await(delivered);
    yield* Fiber.interrupt(hostFiber);
    const error = yield* Fiber.join(call);
    expect(error.threadId).toBe(request.input.threadId);
    expect(error.message).toContain("disconnected");
    expect(yield* broker.connections).toEqual([]);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("bounds a missing response and retains the thread id for reconciliation", () =>
  Effect.gen(function* () {
    const broker = yield* ThreadRoutingBroker.ThreadRoutingBroker;
    const delivered = yield* Deferred.make<void>();
    yield* startHost(() => Deferred.succeed(delivered, undefined).pipe(Effect.asVoid));
    const call = yield* broker.invoke(request).pipe(Effect.flip, Effect.forkChild);
    yield* Deferred.await(delivered);
    yield* TestClock.adjust("31 seconds");
    const error = yield* Fiber.join(call);
    expect(error.message).toContain("timed out");
    expect(error.threadId).toBe(request.input.threadId);
  }).pipe(Effect.provide(testLayer)),
);
