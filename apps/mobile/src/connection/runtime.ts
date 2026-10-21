import { Connection } from "@t3tools/client-runtime/connection";
import { ShellSnapshotLoader } from "@t3tools/client-runtime/state/shell";
import { PullRequestDiffLoader } from "@t3tools/client-runtime/state/pull-requests";
import {
  BoundedThreadSnapshotLoader,
  ThreadSnapshotLoader,
  ThreadHistoryController,
} from "@t3tools/client-runtime/state/threads";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { Atom } from "effect/reactivity";

import type { FoundationHotModule } from "../lib/foundation-fast-refresh";
import { hotSwappableAtomRuntime } from "../lib/hot-swappable-atom-runtime";
import * as Runtime from "../lib/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import * as BackgroundActivity from "./background-activity";
import * as ConnectionPlatform from "./platform";

declare const module: { readonly hot?: FoundationHotModule } | undefined;

const layerProvidedConnectionPlatform = ConnectionPlatform.layer.pipe(Layer.provide(Runtime.layer));

const layerMobileThreadSnapshotLoader = Layer.effect(
  ThreadSnapshotLoader,
  Effect.gen(function* () {
    const loader = yield* ThreadSnapshotLoader;
    const hydration = yield* Semaphore.make(4);
    return ThreadSnapshotLoader.of({
      load: (...args) => loader.load(...args).pipe(hydration.withPermits(1)),
    });
  }),
).pipe(Layer.provide(BoundedThreadSnapshotLoader.layer));

const layerSnapshotLoader = Layer.mergeAll(
  PullRequestDiffLoader.layer,
  layerMobileThreadSnapshotLoader,
  ShellSnapshotLoader.layer,
  ThreadHistoryController.layer,
);

type ConnectionLayerSource =
  | typeof Connection.layer
  | typeof layerSnapshotLoader
  | typeof Runtime.layer
  | typeof ConnectionPlatform.layer
  | typeof BackgroundActivity.layerObserver
  | typeof BackgroundActivity.layerReporter;

const layerProvidedClientConnection = layerSnapshotLoader.pipe(
  Layer.provideMerge(
    Connection.layerWithOptions({ usageLimitSources: true, usageLimitsCommand: true }),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Runtime.layer,
      layerProvidedConnectionPlatform,
      BackgroundActivity.layerObserver,
    ),
  ),
);

const layerConnection = BackgroundActivity.layerReporter.pipe(
  Layer.provideMerge(layerProvidedClientConnection),
);

export const connectionAtomRuntime: Atom.AtomRuntime<
  Layer.Success<ConnectionLayerSource>,
  Layer.Error<ConnectionLayerSource>
> = hotSwappableAtomRuntime({
  id: "t3.mobile.connection-runtime",
  hotModule: typeof module === "undefined" ? undefined : module.hot,
  registry: appAtomRegistry,
  layer: layerConnection,
});
