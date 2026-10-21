// @effect-diagnostics nodeBuiltinImport:off -- The Electron settings path is a Node filesystem boundary.
import type { JavaScriptSource, JavaScriptSourceClient } from "@tonyxiao/javascript-source";
import { ElectronUpdates, type LaunchTarget } from "@tonyxiao/electron-updates";
import * as NodeFSP from "node:fs/promises";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { DESKTOP_JAVASCRIPT_RUNTIME_VERSION } from "@t3tools/contracts";

const LegacyDesktopSettings = Schema.fromJsonString(
  Schema.Struct({ localRendererUrl: Schema.optional(Schema.String) }),
);
const decodeLegacyDesktopSettings = Schema.decodeUnknownEffect(LegacyDesktopSettings);

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
    readonly sourceApi: JavaScriptSourceClient;
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
    const defaultUrl = Option.getOrUndefined(environment.devServerUrl)?.href;
    const legacyUrl = yield* Effect.gen(function* () {
      const contents = yield* Effect.promise(() =>
        NodeFSP.readFile(environment.desktopSettingsPath, "utf8").catch(() => null),
      );
      if (contents === null) return null;
      const value = yield* decodeLegacyDesktopSettings(contents).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      const url = value?.localRendererUrl;
      if (typeof url !== "string" || !URL.canParse(url)) return null;
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
    });
    const store = new ElectronUpdates({
      directory: environment.path.join(environment.stateDir, "javascript-source-updates"),
      builtInDirectory: environment.clientAssetsDir,
      runtimeVersion: DESKTOP_JAVASCRIPT_RUNTIME_VERSION,
      ...(defaultUrl ? { defaultDevelopmentServerUrl: defaultUrl } : {}),
      ...(legacyUrl
        ? { initialSource: { kind: "development-server" as const, url: legacyUrl } }
        : {}),
      // The host coordinates shutdown through DesktopLifecycle rather than letting the library exit.
      reload: async () => {
        throw new Error("Use the desktop lifecycle to restart.");
      },
    });
    yield* attempt(() => store.initialize());
    const sourceApi: JavaScriptSourceClient = store;
    let launch: LaunchTarget | null = null;
    return {
      store,
      sourceApi,
      select: (source) => attempt(() => sourceApi.select(source)),
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
