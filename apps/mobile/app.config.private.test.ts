import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  ["development", "com.tonyxiao.txcode.v2.dev", "txcode-dev"],
  ["preview", "com.tonyxiao.txcode.v2.preview", "txcode-preview"],
  ["production", "com.tonyxiao.txcode.v2", "txcode"],
])(
  "isolates the default %s app from v1 on both mobile platforms",
  async (variant, identifier, scheme) => {
    vi.stubEnv("APP_VARIANT", variant);
    const config = (await import("./app.config.ts")).default;
    expect(config.ios?.bundleIdentifier).toBe(identifier);
    expect(config.android?.package).toBe(identifier);
    expect(config.scheme).toBe(scheme);
    vi.resetModules();
  },
);

it("resolves the separate private EAS identity", async () => {
  vi.stubEnv("APP_VARIANT", "preview");
  vi.stubEnv("T3CODE_MOBILE_APP_ID", "com.tonyxiao.txcode.v2.preview");
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
  expect(config.ios?.bundleIdentifier).toBe("com.tonyxiao.txcode.v2.preview");
  expect(config.android?.package).toBe("com.tonyxiao.txcode.v2.preview");
  expect(config.ios?.appleTeamId).toBe("H82Z395PDV");
  expect(config.owner).toBe("txlforge-tony");
  expect(config.extra?.eas.projectId).toBe("f6cd51c6-6875-4ce4-9360-7aefaf9ee333");
  expect(config.updates?.enabled).toBe(false);
  expect(config.plugins).toContain("./plugins/withPrivateRemoteJs.cjs");
});
