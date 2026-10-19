import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  TextGenerationError,
  type SnoozeTimeResolveInput,
  type SnoozeTimeResolveResult,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerConfig from "../config.ts";

export class SnoozeTime extends Context.Service<
  SnoozeTime,
  {
    readonly resolve: (
      input: SnoozeTimeResolveInput,
    ) => Effect.Effect<SnoozeTimeResolveResult, TextGenerationError>;
  }
>()("t3/textGeneration/SnoozeTime") {}

const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const config = yield* ServerConfig.ServerConfig;
  const resolve = Effect.fn("SnoozeTime.resolve")(function* (input: SnoozeTimeResolveInput) {
    const now = Date.parse(input.now);
    yield* Effect.try({
      try: () => new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(now),
      catch: (cause) =>
        new TextGenerationError({
          operation: "generateSnoozeTime",
          detail: "Invalid current time or timezone.",
          cause,
        }),
    });
    if (!Number.isFinite(now)) {
      return yield* new TextGenerationError({
        operation: "generateSnoozeTime",
        detail: "Invalid current time or timezone.",
      });
    }
    const instances = yield* registry.listInstances;
    const instance = instances.find(
      (candidate) =>
        candidate.enabled &&
        candidate.driverKind === "codex" &&
        candidate.textGeneration.generateSnoozeTime,
    );
    if (!instance?.textGeneration.generateSnoozeTime) {
      return yield* new TextGenerationError({
        operation: "generateSnoozeTime",
        detail: "Connect a Codex account to interpret this date, or use Date and time.",
      });
    }
    const result = yield* instance.textGeneration.generateSnoozeTime({
      ...input,
      cwd: config.cwd,
      modelSelection: createModelSelection(instance.instanceId, "gpt-6-luna", [
        { id: "reasoningEffort", value: "low" },
      ]),
    });
    const timestamp = result.snoozedUntil;
    const wake = timestamp == null ? NaN : Date.parse(timestamp);
    if (
      !timestamp ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ||
      !Number.isFinite(wake) ||
      wake <= now
    ) {
      return yield* new TextGenerationError({
        operation: "generateSnoozeTime",
        detail: "Could not find a future date. Try adding a date and time.",
      });
    }
    return { snoozedUntil: DateTime.formatIso(DateTime.makeUnsafe(wake)) };
  });
  return SnoozeTime.of({ resolve });
});

export const layer = Layer.effect(SnoozeTime, make);
