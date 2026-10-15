import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WS_METHODS,
  type ProjectThreadCreationInput,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Crypto from "effect/Crypto";
import type { ThreadRoutingEvent, ThreadRoutingResponse } from "@t3tools/contracts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import type { PreparedConnection, NetworkStatus } from "./model.ts";
import { EnvironmentRegistry } from "./registry.ts";
import { EnvironmentSupervisor } from "./supervisor.ts";
import {
  PrimaryConnectionTarget,
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "./model.ts";
import type { RpcSession } from "../rpc/session.ts";
import { executeThreadRoutingRequest, watchThreadRouting } from "./threadRouting.ts";

const source = EnvironmentId.make("source");
const target = EnvironmentId.make("target");
const request = {
  operation: "create" as const,
  requestId: "request",
  environmentId: target,
  input: {
    projectId: ProjectId.make("remote-project"),
    threadId: ThreadId.make("new"),
    title: "Remote task",
  },
};
const harness = Effect.fn("threadRoutingClientHarness")(function* (
  options: {
    disabled?: boolean;
    offline?: boolean;
    outdated?: boolean;
  } = {},
) {
  const received = yield* Queue.unbounded<ThreadRoutingEvent>();
  const response = yield* Deferred.make<typeof ThreadRoutingResponse.Type>();
  const registered = yield* Deferred.make<void>();
  const targetCalls: (typeof ProjectThreadCreationInput.Type)[] = [];
  const targets = [source, target].map(
    (environmentId) =>
      new PrimaryConnectionTarget({
        environmentId,
        label: environmentId,
        httpBaseUrl: "https://test.invalid",
        wsBaseUrl: "wss://test.invalid",
      }),
  );
  const entries = yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
    new Map(
      targets.map((entry) => [
        entry.environmentId,
        {
          target: entry,
          enabled: entry.environmentId === target ? !options.disabled : true,
          profile: Option.none(),
        },
      ]),
    ),
  );
  const supervisors = new Map<EnvironmentId, EnvironmentSupervisor["Service"]>();
  for (const entry of targets) {
    const isTarget = entry.environmentId === target;
    // Only the protocol methods used by this bridge are needed for these sessions.
    const session = {
      initialConfig: Effect.succeed({
        environment: {
          capabilities: {
            agentThreadRouting: isTarget ? !options.outdated : true,
          },
        },
      } as ServerConfig),
      client: {
        [WS_METHODS.threadRoutingConnect]: () =>
          isTarget
            ? Stream.never
            : Stream.concat(
                Stream.fromEffect(Deferred.succeed(registered, undefined)).pipe(
                  Stream.flatMap(() => Stream.empty),
                ),
                Stream.fromQueue(received),
              ),
        [WS_METHODS.threadRoutingRespond]: (value: typeof ThreadRoutingResponse.Type) =>
          Deferred.succeed(response, value).pipe(Effect.asVoid),
        [WS_METHODS.threadCreationCreate]: (input: typeof ProjectThreadCreationInput.Type) =>
          Effect.sync(() => {
            expect(isTarget).toBe(true);
            targetCalls.push(input);
            return { threadId: input.threadId, turnStarted: false };
          }),
        [WS_METHODS.threadCreationProjects]: () => Effect.succeed([]),
      },
    } as unknown as RpcSession;
    const state: SupervisorConnectionState = {
      ...AVAILABLE_CONNECTION_STATE,
      phase: isTarget && options.offline ? "offline" : "connected",
      desired: true,
      network: "online",
    };
    supervisors.set(entry.environmentId, {
      target: entry,
      state: yield* SubscriptionRef.make(state),
      session: yield* SubscriptionRef.make(Option.some(session)),
      prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
  }
  const registry = Layer.mock(EnvironmentRegistry)({
    entries,
    networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
    state: (environmentId) => SubscriptionRef.get(supervisors.get(environmentId)!.state),
    stateChanges: (environmentId) => SubscriptionRef.changes(supervisors.get(environmentId)!.state),
    run: (environmentId, effect) =>
      Effect.provideService(effect, EnvironmentSupervisor, supervisors.get(environmentId)!),
    followStream: (environmentId, stream) =>
      Stream.provideService(stream, EnvironmentSupervisor, supervisors.get(environmentId)!),
  });
  return { registry, targetCalls, received, response, registered };
});

it.effect("uses the selected connection's existing session to create a thread", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const result = yield* executeThreadRoutingRequest(request).pipe(Effect.provide(h.registry));
    expect(result).toEqual({ threadId: request.input.threadId, turnStarted: false });
    expect(h.targetCalls).toEqual([request.input]);
  }),
);

for (const options of [{ disabled: true }, { offline: true }, { outdated: true }]) {
  it.effect(`rejects unavailable targets without dispatching: ${JSON.stringify(options)}`, () =>
    Effect.gen(function* () {
      const h = yield* harness(options);
      const error = yield* executeThreadRoutingRequest(request).pipe(
        Effect.provide(h.registry),
        Effect.flip,
      );
      expect(error._tag).toBe("ThreadRoutingError");
      expect(h.targetCalls).toEqual([]);
    }),
  );
}

it.effect("the shared lifecycle bridges a source request and replies on its source session", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    yield* watchThreadRouting().pipe(
      Effect.provide(h.registry),
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      ),
      Effect.forkChild,
    );
    yield* Deferred.await(h.registered);
    yield* Queue.offer(h.received, request);
    const response = yield* Deferred.await(h.response);
    expect(response).toMatchObject({
      requestId: request.requestId,
      result: { threadId: request.input.threadId, turnStarted: false },
    });
    expect(h.targetCalls).toEqual([request.input]);
  }),
);
