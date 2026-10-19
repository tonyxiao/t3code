import * as Schema from "effect/Schema";

export const JavaScriptSourceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("built-in") }),
  Schema.Struct({ kind: Schema.Literal("bundle"), bundleId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("development-server"), url: Schema.String }),
]);
export const JavaScriptSourceSnapshotSchema = Schema.Struct({
  current: JavaScriptSourceSchema,
  selected: JavaScriptSourceSchema,
  runtime: Schema.Struct({
    platform: Schema.Literals(["electron", "ios", "android"]),
    runtimeVersion: Schema.String,
  }),
  defaultDevelopmentServerUrl: Schema.NullOr(Schema.String),
  bundles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      version: Schema.String,
      runtimeVersion: Schema.String,
      compatible: Schema.Boolean,
      status: Schema.Literals(["ready", "failed"]),
    }),
  ),
  capabilities: Schema.Struct({
    importBundle: Schema.Boolean,
    manageBundles: Schema.Boolean,
    developmentServer: Schema.Boolean,
    automaticUpdates: Schema.Boolean,
  }),
  recoveryReason: Schema.NullOr(Schema.String),
});
