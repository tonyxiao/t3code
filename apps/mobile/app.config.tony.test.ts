import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps the new fork build separate from Tony's existing mobile identities", async () => {
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
  const upstream = (await import("./app.config.ts")).default;
  expect(upstream.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode");
  expect(upstream.extra?.eas.projectId).toBe("d763fcb8-d37c-41ea-a773-b54a0ab4a454");

  vi.resetModules();
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", "1");
  vi.stubEnv("T3CODE_MOBILE_REMOTE_JS", "1");
  const tony = (await import("./app.config.ts")).default;
  expect(tony.name).toBe("Tony T3 Code");
  expect(tony.scheme).toBe("tony-t3code");
  expect(tony.ios?.bundleIdentifier).toBe("com.tonyxiao.t3code");
  expect(tony.android?.package).toBe("com.tonyxiao.t3code");
  expect(tony.ios?.appleTeamId).toBe("H82Z395PDV");
  expect(tony.owner).toBe("txlforge-tony");
  expect(tony.extra?.eas.projectId).toBe("f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(tony.updates?.url).toBe("https://u.expo.dev/f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(tony.updates?.enabled).toBe(false);
  expect(tony.plugins).toContain("./plugins/withPrivateRemoteJs.cjs");
});

it("resolves the new private EAS identity without changing the legacy Tony profile", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
  vi.stubEnv("T3CODE_MOBILE_APP_ID", "com.tonyxiao.txcode.preview");
  vi.stubEnv("T3CODE_MOBILE_APP_NAME", "txcode");
  vi.stubEnv("T3CODE_MOBILE_SCHEME", "tony-t3code-preview");
  vi.stubEnv("T3CODE_MOBILE_EAS_OWNER", "txlforge-tony");
  vi.stubEnv("T3CODE_MOBILE_EAS_PROJECT_ID", "f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  vi.stubEnv("T3CODE_MOBILE_APPLE_TEAM_ID", "H82Z395PDV");
  vi.stubEnv("T3CODE_MOBILE_REMOTE_JS", "1");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "0");

  const config = (await import("./app.config.ts")).default;
  expect(config.name).toBe("txcode");
  expect(config.scheme).toBe("tony-t3code-preview");
  expect(config.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode.preview");
  expect(config.android?.package).toBe("com.tonyxiao.txcode.preview");
  expect(config.ios?.appleTeamId).toBe("H82Z395PDV");
  expect(config.owner).toBe("txlforge-tony");
  expect(config.extra?.eas.projectId).toBe("f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(config.updates?.enabled).toBe(false);
  expect(config.plugins).toContain("./plugins/withPrivateRemoteJs.cjs");
});
