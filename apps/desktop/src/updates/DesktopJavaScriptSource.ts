import type { JavaScriptSource, JavaScriptSourceClient } from "@tonyxiao/javascript-source";
import { ElectronUpdates, type LaunchTarget } from "@tonyxiao/electron-updates";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import { DESKTOP_JAVASCRIPT_RUNTIME_VERSION } from "@t3tools/contracts";

export class JavaScriptSourceError extends Schema.TaggedError<JavaScriptSourceError>()(
  "JavaScriptSourceError",
  {
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}
export const attempt = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new JavaScriptSourceError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });
export class DesktopJavaScriptSource extends Context.Service<
  DesktopJavaScriptSource,
  {
    readonly store: ElectronUpdates;
    readonly client: JavaScriptSourceClient;
    readonly select: (source: JavaScriptSource) => Effect.Effect<void, JavaScriptSourceError>;
    readonly prepareLaunch: Effect.Effect<LaunchTarget, JavaScriptSourceError>;
    readonly ready: Effect.Effect<void, JavaScriptSourceError>;
    readonly failLaunch: Effect.Effect<boolean, JavaScriptSourceError>;
  }
>()("@t3tools/desktop/updates/DesktopJavaScriptSource") {}

export const layer = Layer.effect(
  DesktopJavaScriptSource,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const legacy = yield* (yield* DesktopAppSettings.DesktopAppSettings).get;
    const defaultUrl = Option.getOrUndefined(environment.devServerUrl)?.href;
    const store = new ElectronUpdates({
      directory: environment.path.join(environment.stateDir, "javascript-source-updates"),
      builtInDirectory: environment.clientAssetsDir,
      runtimeVersion: DESKTOP_JAVASCRIPT_RUNTIME_VERSION,
      ...(defaultUrl ? { defaultDevelopmentServerUrl: defaultUrl } : {}),
      ...(legacy.localRendererUrl
        ? { initialSource: { kind: "development-server" as const, url: legacy.localRendererUrl } }
        : {}),
      // The host coordinates shutdown through DesktopLifecycle rather than letting the library exit.
      reload: async () => {
        throw new Error("Use the desktop lifecycle to restart.");
      },
    });
    yield* attempt(() => store.initialize());
    const client: JavaScriptSourceClient = store;
    let launch: LaunchTarget | null = null;
    return {
      store,
      client,
      select: (source) => attempt(() => client.select(source)),
      prepareLaunch: attempt(async () => {
        launch = await store.prepareLaunch();
        return launch;
      }),
      ready: attempt(async () => {
        if (launch?.token) await store.notifyAppReady(launch.token);
      }),
      failLaunch: attempt(async () => (launch?.token ? store.failLaunch(launch.token) : false)),
    };
  }),
);
