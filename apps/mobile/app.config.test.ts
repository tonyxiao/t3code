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
  vi.stubEnv("APP_VARIANT", "production");
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

    expect(config.name).toBe("T3 Code");
    expect(config.ios?.bundleIdentifier).toBe("com.example.private");
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

  it("preserves official builds when no overrides are configured", async () => {
    const config = await loadConfig({});
    expect(config.ios?.bundleIdentifier).toBe("com.t3tools.t3code");
    expect(config.android?.package).toBe("com.t3tools.t3code");
    expect(config.ios?.appleTeamId).toBe("ARK85ZXQ4Z");
    expect(config.owner).toBe("pingdotgg");
    expect(config.updates?.enabled).toBe(true);
  });
});
