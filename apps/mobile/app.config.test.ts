import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Keep local credentials out of the build-config fixtures.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ ...process.env }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(env: Record<string, string | undefined>) {
  vi.stubEnv("APP_VARIANT", env.APP_VARIANT ?? "production");
  for (const key of [
    "T3CODE_MOBILE_APP_ID",
    "T3CODE_MOBILE_SCHEME",
    "T3CODE_MOBILE_EAS_PROJECT_ID",
    "T3CODE_MOBILE_EAS_OWNER",
    "T3CODE_MOBILE_SLUG",
    "T3CODE_MOBILE_APPLE_TEAM_ID",
    "T3CODE_MOBILE_ASSOCIATED_DOMAINS",
    "T3CODE_MOBILE_UPDATES_ENABLED",
    "T3CODE_IOS_PERSONAL_TEAM",
  ])
    vi.stubEnv(key, env[key]);
  return (await import("./app.config.ts")).default;
}

describe("private mobile builds", () => {
  it("keeps the display name while isolating signing and update configuration", async () => {
    const config = await loadConfig({
      T3CODE_MOBILE_APP_ID: "com.example.private",
      T3CODE_MOBILE_SCHEME: "example-t3",
    });

    expect(config.name).toBe("txcode");
    expect(config.ios?.bundleIdentifier).toBe("com.example.private");
    expect(config.ios?.infoPlist?.BGTaskSchedulerPermittedIdentifiers).toEqual([
      "com.example.private.background-sync",
    ]);
    expect(config.ios?.infoPlist?.UIBackgroundModes).toContain("processing");
    expect(config.android?.package).toBe("com.example.private");
    expect(config.scheme).toBe("example-t3");
    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.ios?.associatedDomains).toEqual([]);
    expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
      "$(AppIdentifierPrefix)com.example.private",
    ]);
    expect(config.updates?.enabled).toBe(false);
    expect(config.updates?.url).toBeUndefined();
    expect(config.extra?.eas.projectId).toBeUndefined();
    expect(config.owner).toBeUndefined();
  });

  it("derives the update source from the private Expo project", async () => {
    const config = await loadConfig({
      T3CODE_MOBILE_APP_ID: "com.example.private",
      T3CODE_MOBILE_EAS_PROJECT_ID: "00000000-0000-4000-8000-000000000001",
      T3CODE_MOBILE_EAS_OWNER: "example-team",
      T3CODE_MOBILE_SLUG: "private-mobile",
      T3CODE_MOBILE_APPLE_TEAM_ID: "EXAMPLE123",
      T3CODE_MOBILE_ASSOCIATED_DOMAINS:
        "webcredentials:auth.example.com, applinks:auth.example.com",
    });

    expect(config.owner).toBe("example-team");
    expect(config.slug).toBe("private-mobile");
    expect(config.extra?.eas.projectId).toBe("00000000-0000-4000-8000-000000000001");
    expect(config.updates?.url).toBe("https://u.expo.dev/00000000-0000-4000-8000-000000000001");
    expect(config.updates?.enabled).toBe(true);
    expect(config.ios?.appleTeamId).toBe("EXAMPLE123");
    expect(config.ios?.associatedDomains).toEqual([
      "webcredentials:auth.example.com",
      "applinks:auth.example.com",
    ]);
  });

  it.each([
    ["production", "com.tonyxiao.txcode"],
    ["development", "com.tonyxiao.txcode.dev"],
    ["preview", "com.tonyxiao.txcode.preview"],
  ])("uses our %s identity without upstream signing or updates", async (variant, bundleId) => {
    const config = await loadConfig({ APP_VARIANT: variant });
    expect(config.ios?.bundleIdentifier).toBe(bundleId);
    expect(config.android?.package).toBe(bundleId);
    expect(config.ios?.infoPlist?.BGTaskSchedulerPermittedIdentifiers).toEqual([
      `${bundleId}.background-sync`,
    ]);
    expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
      `$(AppIdentifierPrefix)${bundleId}`,
    ]);
    expect(config.ios?.appleTeamId).toBeUndefined();
    expect(config.ios?.associatedDomains).toEqual([]);
    expect(config.owner).toBeUndefined();
    expect(config.updates?.enabled).toBe(false);
    expect(config.updates?.url).toBeUndefined();
    expect(config.extra?.eas.projectId).toBeUndefined();
    expect(config.plugins).toContainEqual([
      "expo-widgets",
      expect.objectContaining({
        bundleIdentifier: `${bundleId}.widgets`,
        groupIdentifier: `group.${bundleId}`,
      }),
    ]);
    expect(config.plugins).toContainEqual([
      "expo-sharing",
      expect.objectContaining({
        ios: expect.objectContaining({
          extensionBundleIdentifier: `${bundleId}.sharing`,
          appGroupId: `group.${bundleId}`,
        }),
      }),
    ]);
  });
});
