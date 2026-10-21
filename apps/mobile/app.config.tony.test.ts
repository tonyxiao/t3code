import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("keeps v2 builds separate from Tony's v1 mobile identities", async () => {
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
  const upstream = (await import("./app.config.ts")).default;
  expect(upstream.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode.v2");
  expect(upstream.extra?.eas.projectId).toBe("d763fcb8-d37c-41ea-a773-b54a0ab4a454");

  vi.resetModules();
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", "1");
  vi.stubEnv("T3CODE_MOBILE_REMOTE_JS", "1");
  const tony = (await import("./app.config.ts")).default;
  expect(tony.name).toBe("Tony txcode");
  expect(tony.scheme).toBe("tony-txcode");
  expect(tony.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode.tony");
  expect(tony.android?.package).toBe("com.tonyxiao.txcode.tony");
  expect(tony.ios?.appleTeamId).toBe("H82Z395PDV");
  expect(tony.owner).toBe("txlforge-tony");
  expect(tony.extra?.eas.projectId).toBe("f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(tony.updates?.url).toBe("https://u.expo.dev/f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(tony.updates?.enabled).toBe(false);
  expect(tony.plugins).toContain("./plugins/withPrivateRemoteJs.cjs");
});

it.each([
  ["development", "com.tonyxiao.txcode.v2.dev", "txcode-dev"],
  ["preview", "com.tonyxiao.txcode.v2.preview", "txcode-preview"],
  ["production", "com.tonyxiao.txcode.v2", "txcode"],
])(
  "isolates the default %s app from v1 on both mobile platforms",
  async (variant, identifier, scheme) => {
    vi.stubEnv("APP_VARIANT", variant);
    vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
    const config = (await import("./app.config.ts")).default;
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.android?.package).toBe(identifier);
    expect(config.scheme).toBe(scheme);
    vi.resetModules();
  },
);

it.each([
  ["development", "com.tonyxiao.txcode.tony.dev", "tony-txcode-dev"],
  ["preview", "com.tonyxiao.txcode.tony.preview", "tony-txcode-preview"],
  ["production", "com.tonyxiao.txcode.tony", "tony-txcode"],
])("isolates the Tony %s app on both mobile platforms", async (variant, identifier, scheme) => {
  vi.stubEnv("APP_VARIANT", variant);
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", "1");
  const config = (await import("./app.config.ts")).default;
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  expect(config.scheme).toBe(scheme);
  vi.resetModules();
});

it("resolves the separate private EAS identity", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  vi.stubEnv("T3CODE_MOBILE_TONY_BUILD", undefined);
  vi.stubEnv("T3CODE_MOBILE_APP_ID", "com.tonyxiao.txcode.preview");
  vi.stubEnv("T3CODE_MOBILE_APP_NAME", "txcode");
  vi.stubEnv("T3CODE_MOBILE_SCHEME", "txcode-preview");
  vi.stubEnv("T3CODE_MOBILE_EAS_OWNER", "txlforge-tony");
  vi.stubEnv("T3CODE_MOBILE_EAS_PROJECT_ID", "f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  vi.stubEnv("T3CODE_MOBILE_APPLE_TEAM_ID", "H82Z395PDV");
  vi.stubEnv("T3CODE_MOBILE_REMOTE_JS", "1");
  vi.stubEnv("T3CODE_MOBILE_UPDATES_ENABLED", "0");

  const config = (await import("./app.config.ts")).default;
  expect(config.name).toBe("txcode");
  expect(config.scheme).toBe("txcode-preview");
  expect(config.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode.preview");
  expect(config.android?.package).toBe("com.tonyxiao.txcode.preview");
  expect(config.ios?.appleTeamId).toBe("H82Z395PDV");
  expect(config.owner).toBe("txlforge-tony");
  expect(config.extra?.eas.projectId).toBe("f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(config.updates?.enabled).toBe(false);
  expect(config.plugins).toContain("./plugins/withPrivateRemoteJs.cjs");
});
