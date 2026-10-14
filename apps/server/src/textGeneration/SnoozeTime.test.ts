import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ServerConfig from "../config.ts";
import * as SnoozeTime from "./SnoozeTime.ts";
import type { SnoozeTimeGenerationInput } from "./TextGeneration.ts";

const input = { text: "oct 23", now: "2026-10-14T10:00:00.000Z", timeZone: "Asia/Hong_Kong" };
const makeLayer = (instances: readonly ProviderInstance[]) =>
  SnoozeTime.layer.pipe(
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        listInstances: Effect.succeed(instances),
      }),
    ),
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-snooze-test-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
function instance(
  generateSnoozeTime: (
    input: SnoozeTimeGenerationInput,
  ) => Effect.Effect<{ snoozedUntil: string | null }>,
  enabled = true,
): ProviderInstance {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driverKind: ProviderDriverKind.make("codex"),
    enabled,
    continuationIdentity: {
      driverKind: ProviderDriverKind.make("codex"),
      continuationKey: "codex:test",
    },
    displayName: undefined,
    snapshot: {} as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: {
      generateCommitMessage: () => Effect.die("unused"),
      generatePrContent: () => Effect.die("unused"),
      generateBranchName: () => Effect.die("unused"),
      generateThreadTitle: () => Effect.die("unused"),
      generateSnoozeTime,
    },
  };
}
let received: SnoozeTimeGenerationInput | undefined;
it.effect("resolves a natural date with Luna using the client's clock and timezone", () =>
  Effect.gen(function* () {
    const service = yield* SnoozeTime.SnoozeTime;
    const result = yield* service.resolve(input);
    expect(result.snoozedUntil).toBe("2026-10-23T01:00:00.000Z");
    expect(received).toMatchObject({ ...input, modelSelection: { model: "gpt-6-luna" } });
  }).pipe(
    Effect.provide(
      makeLayer([
        instance((value) => {
          received = value;
          return Effect.succeed({ snoozedUntil: "2026-10-23T09:00:00+08:00" });
        }),
      ]),
    ),
  ),
);
for (const snoozedUntil of [null, "invalid", "2026-10-13T09:00:00Z", "2026-10-23T09:00:00"]) {
  it.effect(`rejects an unusable generated date: ${snoozedUntil}`, () =>
    Effect.gen(function* () {
      const service = yield* SnoozeTime.SnoozeTime;
      const result = yield* Effect.result(service.resolve(input));
      expect(Result.isFailure(result)).toBe(true);
    }).pipe(Effect.provide(makeLayer([instance(() => Effect.succeed({ snoozedUntil }))]))),
  );
}
it.effect("reports unavailable Luna without using a disabled account", () =>
  Effect.gen(function* () {
    const service = yield* SnoozeTime.SnoozeTime;
    const result = yield* Effect.result(service.resolve(input));
    expect(Result.isFailure(result)).toBe(true);
  }).pipe(Effect.provide(makeLayer([instance(() => Effect.die("must not run"), false)]))),
);
