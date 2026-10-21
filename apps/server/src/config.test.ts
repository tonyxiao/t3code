// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ServerConfig from "./config.ts";

describe("otlpResource", () => {
  const resource = (resourceAttributes: Record<string, string>) =>
    ServerConfig.otlpResource(
      { mode: "web", otelEnvironment: { ...OtelEnvironment.none, resourceAttributes } },
      "box-1",
    );

  it("names the host, unless OTEL_RESOURCE_ATTRIBUTES already does", () => {
    assert.equal(resource({}).attributes["host.name"], "box-1");
    assert.equal(resource({ "host.name": "from-env" }).attributes["host.name"], "from-env");
    assert.equal(resource({ "host.name": "" }).attributes["host.name"], "box-1");
  });
});

it.effect("isolates V2 secrets and imports only portable provider credentials once", () => {
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-secrets-"));
  const source = NodePath.join(baseDir, "userdata", "secrets");
  NodeFS.mkdirSync(source, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(source, "provider-auth-abc.bin"), "provider-v1");
  NodeFS.writeFileSync(NodePath.join(source, "source-control-Z2l0aHVi-token.bin"), "git-v1");
  NodeFS.writeFileSync(NodePath.join(source, "server-signing-key.bin"), "signing-v1");
  NodeFS.writeFileSync(NodePath.join(source, "cloud-relay-environment-credential.bin"), "relay-v1");
  return Effect.gen(function* () {
    const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
    assert.equal(paths.secretsDir, NodePath.join(baseDir, "userdata", "secrets-v2"));
    yield* ServerConfig.ensureServerDirectories(paths);
    assert.equal(
      NodeFS.readFileSync(NodePath.join(paths.secretsDir, "provider-auth-abc.bin"), "utf8"),
      "provider-v1",
    );
    assert.equal(
      NodeFS.readFileSync(
        NodePath.join(paths.secretsDir, "source-control-Z2l0aHVi-token.bin"),
        "utf8",
      ),
      "git-v1",
    );
    assert.isFalse(NodeFS.existsSync(NodePath.join(paths.secretsDir, "server-signing-key.bin")));
    assert.isFalse(
      NodeFS.existsSync(NodePath.join(paths.secretsDir, "cloud-relay-environment-credential.bin")),
    );
    NodeFS.writeFileSync(NodePath.join(source, "provider-auth-abc.bin"), "provider-v1-later");
    yield* ServerConfig.ensureServerDirectories(paths);
    assert.equal(
      NodeFS.readFileSync(NodePath.join(paths.secretsDir, "provider-auth-abc.bin"), "utf8"),
      "provider-v1",
    );
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true }))),
  );
});
