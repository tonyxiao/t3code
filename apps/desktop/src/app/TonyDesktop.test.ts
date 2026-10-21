// @effect-diagnostics nodeBuiltinImport:off - Test supplies the host path joiner to pure state-path functions.
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Option from "effect/Option";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

vi.stubGlobal("__T3CODE_TONY_DESKTOP__", true);
vi.mock("electron", () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }));

it.effect("isolates private desktop state and URL handling from the installed upstream app", () =>
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
      "/Users/tony/.t3-tony",
    );
    assert.equal(protocol.getDesktopUrl(false), "tony-txcode://app/");
    assert.equal(
      yield* userData.resolveUserDataPath({
        appDataDirectory: "/Users/tony/Library/Application Support",
        isDevelopment: false,
        platform: "darwin",
      }),
      "/Users/tony/Library/Application Support/tony-txcode-v2",
    );
    assert.equal(
      environment.resolveDesktopAppBranding({ isDevelopment: false, appVersion: "1.0.0" })
        .displayName,
      "Tony txcode (Alpha)",
    );
    assert.equal(early.resolveLinuxDesktopEntryName(false), "com.tonyxiao.txcode.tony.desktop");
  }).pipe(Effect.provide(NodeServices.layer)),
);
