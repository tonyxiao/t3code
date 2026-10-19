import {
  AuthStandardClientScopes,
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConnectionBlockedError } from "./model.ts";

import { remoteHttpClientLayer } from "../rpc/http.ts";
import { ClientPresentation, SshEnvironmentGateway } from "../platform/capabilities.ts";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
} from "./catalog.ts";
import { BearerConnectionTarget, PrimaryConnectionTarget } from "./model.ts";
import {
  prepareBearerConnectionUpdate,
  preparePairingRegistration,
  pairingCatalogConflict,
  prepareSshRegistration,
} from "./onboarding.ts";

const CLIENT_PRESENTATION_LAYER = Layer.succeed(
  ClientPresentation,
  ClientPresentation.of({
    metadata: {
      label: "T3 Code Test",
      deviceType: "desktop",
      os: "Test OS",
    },
    scopes: AuthStandardClientScopes,
  }),
);

describe("pairing catalog identity", () => {
  const remoteId = EnvironmentId.make("remote-a");
  const otherId = EnvironmentId.make("remote-b");
  const remote: ConnectionCatalogEntry = {
    target: new BearerConnectionTarget({
      environmentId: remoteId,
      label: "A",
      connectionId: "bearer:remote-a",
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: "bearer:remote-a",
        environmentId: remoteId,
        label: "A",
        httpBaseUrl: "https://a.example/",
        wsBaseUrl: "wss://a.example/",
      }),
    ),
    enabled: false,
  };
  const local: ConnectionCatalogEntry = {
    target: new PrimaryConnectionTarget({
      environmentId: otherId,
      label: "Local",
      httpBaseUrl: "http://localhost/",
      wsBaseUrl: "ws://localhost/",
    }),
    profile: Option.none(),
    enabled: true,
  };

  it("accepts re-pairing the same trusted identity, even after an address change", () => {
    const entries = new Map([
      [remoteId, remote],
      [otherId, local],
    ]);
    expect(pairingCatalogConflict(entries, remoteId, "https://a.example/")).toBeNull();
    expect(pairingCatalogConflict(entries, remoteId, "https://moved.example/")).toBeNull();
    expect(entries.get(otherId)).toBe(local);
    expect(entries.get(remoteId)?.enabled).toBe(false);
  });

  it("rejects a different identity on a saved URL and refuses to replace local state", () => {
    const entries = new Map([
      [remoteId, remote],
      [otherId, local],
    ]);
    expect(pairingCatalogConflict(entries, otherId, "https://a.example/")?.detail).toContain(
      "different connection type",
    );
    expect(
      pairingCatalogConflict(entries, EnvironmentId.make("intruder"), "https://a.example")?.detail,
    ).toContain("different environment identity");
    expect(entries.size).toBe(2);
  });
});

function pairingHttpLayer(
  calls: Array<{ readonly url: string; readonly init: RequestInit }>,
  options?: { readonly failDescriptor?: boolean; readonly protocolVersion?: number },
) {
  const fetchFn = ((input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/.well-known/t3/environment")) {
      if (options?.failDescriptor === true) {
        return Promise.resolve(
          Response.json({ message: "descriptor unavailable" }, { status: 503 }),
        );
      }
      return Promise.resolve(
        Response.json({
          environmentId: "environment-paired",
          label: "Paired environment",
          platform: {
            os: "linux",
            arch: "x64",
          },
          serverVersion: "0.0.0-test",
          orchestrationProtocolVersion: options?.protocolVersion ?? ORCHESTRATION_PROTOCOL_VERSION,
          capabilities: {
            repositoryIdentity: true,
          },
        }),
      );
    }

    if (url.endsWith("/oauth/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "bearer-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: AuthStandardClientScopes.join(" "),
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected request: ${url}`));
  }) satisfies typeof fetch;

  return remoteHttpClientLayer(fetchFn);
}

describe("connection onboarding", () => {
  it.effect("rejects a descriptor identity conflict before consuming the one-time token", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const error = yield* preparePairingRegistration(
        { pairingUrl: "http://tailnet.example:3773/pair#token=one-time-secret" },
        () =>
          Effect.fail(
            new ConnectionBlockedError({ reason: "configuration", detail: "identity conflict" }),
          ),
      ).pipe(
        Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, pairingHttpLayer(calls))),
        Effect.flip,
      );
      expect(error).toMatchObject({ reason: "configuration", detail: "identity conflict" });
      expect(calls.map((call) => call.url)).toEqual([
        "http://tailnet.example:3773/.well-known/t3/environment",
      ]);
    }),
  );

  it.effect("prepares a persisted bearer registration from pairing details", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const registration = yield* preparePairingRegistration({
        host: "remote.example.test",
        pairingCode: "pairing-token",
      }).pipe(Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, pairingHttpLayer(calls))));

      expect(registration).toMatchObject({
        _tag: "BearerConnectionRegistration",
        target: {
          environmentId: "environment-paired",
          label: "Paired environment",
          connectionId: "bearer:environment-paired",
        },
        profile: {
          environmentId: "environment-paired",
          label: "Paired environment",
          connectionId: "bearer:environment-paired",
          httpBaseUrl: "https://remote.example.test/",
          wsBaseUrl: "wss://remote.example.test/",
        },
        credential: {
          token: "bearer-token",
        },
      });
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/t3/environment",
        "https://remote.example.test/oauth/token",
      ]);

      const tokenRequest = calls.find((call) => call.url.endsWith("/oauth/token"));
      const tokenBody =
        tokenRequest?.init.body instanceof Uint8Array
          ? new TextDecoder().decode(tokenRequest.init.body)
          : String(tokenRequest?.init.body);
      const tokenParams = new URLSearchParams(tokenBody);
      expect(tokenParams.get("subject_token")).toBe("pairing-token");
      expect(tokenParams.get("scope")).toBe(AuthStandardClientScopes.join(" "));
      expect(tokenParams.get("client_label")).toBe("T3 Code Test");
    }),
  );

  it.effect("rejects an incompatible server without consuming the pairing credential", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const error = yield* preparePairingRegistration({
        host: "remote.example.test",
        pairingCode: "pairing-token",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            CLIENT_PRESENTATION_LAYER,
            pairingHttpLayer(calls, { protocolVersion: ORCHESTRATION_PROTOCOL_VERSION + 1 }),
          ),
        ),
        Effect.flip,
      );
      expect(error).toMatchObject({ reason: "unsupported" });
      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/t3/environment",
      ]);
    }),
  );

  it.effect("does not consume a pairing credential when descriptor discovery fails", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];

      yield* preparePairingRegistration({
        host: "remote.example.test",
        pairingCode: "pairing-token",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            CLIENT_PRESENTATION_LAYER,
            pairingHttpLayer(calls, { failDescriptor: true }),
          ),
        ),
        Effect.flip,
      );

      expect(calls.map((call) => call.url)).toEqual([
        "https://remote.example.test/.well-known/t3/environment",
      ]);
    }),
  );

  it.effect("rejects invalid pairing details before making a request", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
      const error = yield* preparePairingRegistration({
        host: "",
        pairingCode: "",
      }).pipe(
        Effect.provide(Layer.mergeAll(CLIENT_PRESENTATION_LAYER, pairingHttpLayer(calls))),
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "configuration",
        message: "Enter a backend URL.",
      });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("updates bearer metadata while preserving the credential and identity", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("environment-paired");
      const registration = yield* prepareBearerConnectionUpdate({
        input: {
          environmentId,
          label: "  Renamed environment  ",
          httpBaseUrl: "http://100.65.180.100:3773/path",
        },
        entry: Option.some({
          target: new BearerConnectionTarget({
            environmentId,
            label: "Old label",
            connectionId: "bearer:environment-paired",
          }),
          profile: Option.some(
            new BearerConnectionProfile({
              connectionId: "bearer:environment-paired",
              environmentId,
              label: "Old label",
              httpBaseUrl: "http://old.example.test/",
              wsBaseUrl: "ws://old.example.test/",
            }),
          ),
          enabled: true,
        }),
        credential: Option.some(new BearerConnectionCredential({ token: "bearer-token" })),
      });

      expect(registration).toMatchObject({
        target: {
          environmentId,
          label: "Renamed environment",
          connectionId: "bearer:environment-paired",
        },
        profile: {
          environmentId,
          label: "Renamed environment",
          httpBaseUrl: "http://100.65.180.100:3773/",
          wsBaseUrl: "ws://100.65.180.100:3773/",
        },
        credential: { token: "bearer-token" },
      });
    }),
  );

  it.effect("prepares an SSH registration from the provisioned platform environment", () =>
    Effect.gen(function* () {
      const target = {
        alias: "devbox",
        hostname: "devbox.example.test",
        username: "developer",
        port: 22,
      };
      const registration = yield* prepareSshRegistration({
        target,
      }).pipe(
        Effect.provideService(
          SshEnvironmentGateway,
          SshEnvironmentGateway.of({
            provision: () =>
              Effect.succeed({
                environmentId: EnvironmentId.make("environment-ssh"),
                label: "Remote development box",
                bootstrap: {
                  target,
                  httpBaseUrl: "http://127.0.0.1:3201",
                  wsBaseUrl: "ws://127.0.0.1:3201",
                  pairingToken: "pairing-token",
                },
                bearerToken: "bearer-token",
              }),
            prepare: () => Effect.die("unused"),
            disconnect: () => Effect.die("unused"),
          }),
        ),
      );

      expect(registration).toMatchObject({
        _tag: "SshConnectionRegistration",
        target: {
          environmentId: "environment-ssh",
          label: "Remote development box",
          connectionId: "ssh:environment-ssh",
        },
        profile: {
          environmentId: "environment-ssh",
          label: "Remote development box",
          connectionId: "ssh:environment-ssh",
          target,
        },
      });
    }),
  );
});
