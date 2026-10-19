import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps upstream builds separate from Tony's existing mobile identities", async () => {
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
  const upstream = (await import("./app.config.ts")).default;
  expect(upstream.ios?.bundleIdentifier).toBe("com.t3tools.t3code");
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
