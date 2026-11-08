import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { mergeProviderSnapshot } from "./ProviderRegistry.ts";

const cached = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "authenticated" },
  version: "0.159.0",
  checkedAt: "2026-11-08T00:00:00.000Z",
  models: [{ slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

it("retains usable cached installation and auth until the startup probe answers", () => {
  const pending = {
    ...cached,
    installed: false,
    version: null,
    status: "warning",
    auth: { status: "unknown" },
    models: [],
  } satisfies ServerProvider;
  const snapshot = mergeProviderSnapshot(cached, pending);
  expect(snapshot).toMatchObject({
    installed: true,
    version: cached.version,
    auth: cached.auth,
    models: cached.models,
  });
  expect(
    mergeProviderSnapshot(snapshot, { ...pending, status: "error", message: "CLI missing" }),
  ).toMatchObject({ installed: false, version: null, status: "error" });
});
