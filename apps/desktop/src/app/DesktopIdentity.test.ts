// @effect-diagnostics nodeBuiltinImport:off - Test supplies the host path joiner to pure state-path functions.
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Option from "effect/Option";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

vi.mock("electron", () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }));

it.effect("isolates V2 desktop state and URL handling from the installed upstream app", () =>
  Effect.gen(function* () {
    const paths = yield* Effect.promise(() => import("./DesktopStatePaths.ts"));
    const protocol = yield* Effect.promise(() => import("../electron/ElectronProtocol.ts"));
    const environment = yield* Effect.promise(() => import("./DesktopEnvironment.ts"));
    const early = yield* Effect.promise(() => import("./DesktopEarlyElectronStartup.ts"));
    const userData = yield* Effect.promise(() => import("./DesktopUserData.ts"));
    assert.equal(
      paths.resolveDesktopBaseDir({
        homeDirectory: "/Users/tony",
        joinPath: NodePath.join,
        t3Home: Option.none(),
      }),
      "/Users/tony/.t3",
    );
    assert.equal(protocol.getDesktopUrl(false), "txcode://app/");
    assert.equal(
      yield* userData.resolveUserDataPath({
        appDataDirectory: "/Users/tony/Library/Application Support",
        isDevelopment: false,
        platform: "darwin",
      }),
      "/Users/tony/Library/Application Support/t3code-v2",
    );
    assert.equal(
      environment.resolveDesktopAppBranding({ isDevelopment: false, appVersion: "1.0.0" })
        .displayName,
      "TX Code (Alpha)",
    );
    assert.equal(early.resolveLinuxDesktopEntryName(false), "com.tonyxiao.txcode.v2.desktop");
  }).pipe(Effect.provide(NodeServices.layer)),
);
