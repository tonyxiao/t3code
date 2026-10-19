import { JavaScriptSourceSchema, JavaScriptSourceSnapshotSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as Sources from "../../updates/DesktopJavaScriptSource.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getJavaScriptSourceState = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_STATE,
  payload: Schema.Void,
  result: JavaScriptSourceSnapshotSchema,
  handler: Effect.fn("desktop.ipc.javascriptSource.state")(function* () {
    const { store } = yield* Sources.DesktopJavaScriptSource;
    return yield* Sources.attempt(() => store.snapshot());
  }),
});
export const selectJavaScriptSource = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_SELECT,
  payload: JavaScriptSourceSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.select")(function* (source) {
    const { store } = yield* Sources.DesktopJavaScriptSource;
    yield* Sources.attempt(() => store.select(source));
  }),
});
export const resetJavaScriptDevelopmentServer = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_RESET_SERVER,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.resetServer")(function* () {
    const { store } = yield* Sources.DesktopJavaScriptSource;
    yield* Sources.attempt(() => store.resetDevelopmentServer());
  }),
});
export const importJavaScriptBundle = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_IMPORT,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.import")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const { store } = yield* Sources.DesktopJavaScriptSource;
    const paths = yield* dialog.pickFiles({
      owner: Option.none(),
      defaultPath: Option.none(),
      multiple: false,
      filters: [{ name: "JavaScript bundle", extensions: ["zip"] }],
    });
    if (paths[0]) yield* Sources.attempt(() => store.importBundle(paths[0]!).then(() => {}));
  }),
});
export const deleteJavaScriptBundle = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_DELETE,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.delete")(function* (id) {
    const { store } = yield* Sources.DesktopJavaScriptSource;
    yield* Sources.attempt(() => store.deleteBundle(id));
  }),
});
export const reloadJavaScriptSource = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_RELOAD,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.reload")(function* () {
    yield* (yield* DesktopLifecycle.DesktopLifecycle).relaunch("javascript-source");
  }),
});
export const notifyJavaScriptReady = makeIpcMethod({
  channel: IpcChannels.JAVASCRIPT_SOURCE_READY,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.javascriptSource.ready")(function* () {
    yield* (yield* Sources.DesktopJavaScriptSource).ready;
  }),
});
