import { Connection } from "@t3tools/client-runtime/connection";
import { shellSnapshotLoaderLayer } from "@t3tools/client-runtime/state/shell";
import {
  ThreadSnapshotLoader,
  threadSnapshotLoaderLayer,
} from "@t3tools/client-runtime/state/threads";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { Atom } from "effect/unstable/reactivity";

import type { FoundationHotModule } from "../lib/foundation-fast-refresh";
import { hotSwappableAtomRuntime } from "../lib/hot-swappable-atom-runtime";
import { runtimeContextLayer } from "../lib/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import {
  mobileBackgroundActivityObserverLayer,
  mobileBackgroundActivityReporterLayer,
} from "./background-activity";
import { connectionPlatformLayer } from "./platform";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const providedConnectionPlatformLayer = connectionPlatformLayer.pipe(
  Layer.provide(runtimeContextLayer),
);

// Proactive subscriptions share a small hydration budget instead of issuing a
// snapshot request for every open thread simultaneously on launch/reconnect.
const mobileThreadSnapshotLoaderLayer = Layer.effect(
  ThreadSnapshotLoader,
  Effect.gen(function* () {
    const loader = yield* ThreadSnapshotLoader;
    const hydration = yield* Semaphore.make(4);
    return ThreadSnapshotLoader.of({
      load: (...args) => loader.load(...args).pipe(hydration.withPermits(1)),
    });
  }),
).pipe(Layer.provide(threadSnapshotLoaderLayer));

const snapshotLoaderLayer = Layer.merge(mobileThreadSnapshotLoaderLayer, shellSnapshotLoaderLayer);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof snapshotLoaderLayer
  | typeof runtimeContextLayer
  | typeof connectionPlatformLayer
  | typeof mobileBackgroundActivityObserverLayer
  | typeof mobileBackgroundActivityReporterLayer;

const providedClientConnectionLayer = snapshotLoaderLayer.pipe(
  Layer.provideMerge(
    Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      runtimeContextLayer,
      providedConnectionPlatformLayer,
      mobileBackgroundActivityObserverLayer,
    ),
  ),
);

const connectionLayer = mobileBackgroundActivityReporterLayer.pipe(
  Layer.provideMerge(providedClientConnectionLayer),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = hotSwappableAtomRuntime({
  id: "t3.mobile.connection-runtime",
  hotModule: typeof module === "undefined" ? undefined : module.hot,
  registry: appAtomRegistry,
  layer: connectionLayer,
});
