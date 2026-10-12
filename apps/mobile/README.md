# T3 Code Mobile

> [!WARNING]
> T3 Code Mobile is currently in development and is not distributed yet. If you want to try it out, you can build it from source.

## Quickstart

> [!NOTE]
> Uses native modules so using Expo Go is not supported. You need to use the Expo Dev Client.

This app has three variants:

- `development`: Expo dev client, installable side-by-side as `T3 Code Dev`
- `preview`: persistent internal preview build, installable side-by-side as `T3 Code Preview`
- `production`: store/release build as `T3 Code`

Run commands from `apps/mobile`.

T3 Connect is optional and disabled in a fresh clone. Public configuration belongs in the
repository-root `.env` or `.env.local`, not an `apps/mobile/.env` file. See
[`../../.env.example`](../../.env.example).

## Development

For simulator/emulator development, select and boot a device, then ensure its native client matches
this checkout before starting Metro:

```bash
node ../../scripts/mobile-native-client.ts ensure ios <simulator-udid>
# Or: node ../../scripts/mobile-native-client.ts ensure android <emulator-serial>
vp run dev:client
```

The helper compares a local Expo fingerprint and the installed binary with its last successful
build record. It builds and installs missing, stale, or unverified clients and reuses matching ones.
Use `check` instead of `ensure` for a read-only decision: exit 0 means compatible, 2 means a build is
needed, and 1 means an operational error. Run it on the simulator host; no EAS login is required.
An externally installed client is unverified until the helper builds it once.

Start Metro for an already verified dev client:

```bash
vp run dev:client
```

Metro keeps its transform cache between ordinary starts. If the cache itself is causing stale or
invalid output, clear it for one development-client start:

```bash
vp run dev:client:reset
```

Run that reset once after installing or changing the Uniwind dependency patch. Cached transforms
can otherwise reference its previous pnpm package path. Ordinary Metro starts still keep the cache.

Component edits use Fast Refresh. See [mobile development lifecycle](../../docs/internals/mobile-development.md)
before changing runtime ownership or refresh behavior.

Build and run the local iOS dev client:

```bash
vp run ios:dev
```

After changing a native dependency patch, rerun CocoaPods before rebuilding an existing iOS
project. pnpm gives each patch hash a new package path; Pods can otherwise keep compiling the
previous directory.

If your Xcode account only has a Personal Team, use a bundle identifier you control and opt into the
reduced-capability local build. Personal Team builds omit the widget and share extensions, push
entitlement, and native Sign in with Apple entitlement; builds without this opt-in are unchanged.

```bash
T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.t3code.dev \
vp run ios:dev
```

Build and install a self-contained Release app that does not need Metro:

```bash
vp run ios:release
```

The Personal Team equivalent also needs a unique bundle identifier:

```bash
T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.t3code \
vp run ios:release
```

Build and run the local iOS preview app:

```bash
vp run ios:preview
```

Force the review diff highlighter engine:

```bash
EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=javascript vp run ios:dev
```

`javascript` is the default and recommended setting for the review diff screen. Set `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native` only when you explicitly want to test the native Shiki engine.

Inspect the resolved Expo config for a variant:

```bash
vp run config:dev
vp run config:preview
```

Run static checks for mobile native code:

```bash
node ../../scripts/mobile-native-static-check.ts
```

The native lint task runs SwiftLint for Swift plus ktlint and detekt for Kotlin. Missing native tools are reported as warnings and skipped locally. CI installs the default toolset from `apps/mobile/Brewfile` before running the native checks.

## EAS Builds

### Private distribution

The `private` build profile produces a self-contained APK or ad hoc iOS build named
**T3 Code**, using `com.txlforge.t3code` and the `txlforge-t3` URL scheme. OTA updates
are disabled. Register iOS devices before building; adding devices requires a new
provisioning profile or a re-signed build.

The profile targets `@txlforge/t3-code-mobile`. To use another Expo project, update
`T3CODE_MOBILE_EAS_OWNER` and `T3CODE_MOBILE_EAS_PROJECT_ID` in the profile and the
repository-root `.env.local`. Set `T3CODE_MOBILE_APPLE_TEAM_ID` in `.env.local` and
the project's EAS `preview` environment once your Apple membership is active.
For Android push, set the EAS file variable
`T3CODE_ANDROID_GOOGLE_SERVICES_FILE` to the Firebase configuration for
`com.txlforge.t3code`. Keep signing keys and service-account credentials outside
the repository. The FCM service-account credential belongs on the relay, not in
the mobile bundle; see [Android notifications](../../docs/operations/android-notifications.md).

From `apps/mobile`, run `eas build --profile private --platform android` or
`eas build --profile private --platform ios`. EAS can provision signing credentials
interactively. If you already have a keystore, upload it with
`eas credentials:configure-build --profile private --platform android` rather
than generating a different one. Keep a secure backup for future updates.

For local native builds, set `APP_VARIANT=production`,
`T3CODE_MOBILE_APP_ID=com.txlforge.t3code`, `T3CODE_MOBILE_SCHEME=txlforge-t3`,
`T3CODE_MOBILE_SLUG=t3-code-mobile`, and `T3CODE_MOBILE_UPDATES_ENABLED=0` as well.
`T3CODE_MOBILE_ASSOCIATED_DOMAINS` accepts comma-separated entitlement entries if
you configure your own sign-in domains. Private identities omit upstream signing
teams and associated domains by default. Native dependencies require rebuilding
the binary; Expo Go cannot run this app.

Preview and production variants use Expo fingerprinting so OTA updates only reach binaries with matching native dependencies, config plugins, and patches. CI uses the `preview:dev` profile to reuse a compatible native build when possible.

The development variant uses `appVersion` to avoid recalculating the native fingerprint for each Metro launch manifest. `MOBILE_VERSION_POLICY` can override either default. If you distribute a custom Release build with the development identity and publish OTA updates to it, set `MOBILE_VERSION_POLICY=fingerprint` for both its build and updates. Changing the runtime policy requires a native rebuild for OTA matching; an existing dev client can still load local Metro bundles.

For preview or production EAS environments, set `T3CODE_CLERK_PUBLISHABLE_KEY`,
`T3CODE_CLERK_JWT_TEMPLATE`, and `T3CODE_RELAY_URL`
as EAS environment variables. Expo config maps the canonical values into the mobile build.

Create a PR preview dev-client build manually:

```bash
vp run eas:ios:preview:dev
```

Create a cloud dev-client build:

```bash
vp run eas:ios:dev
```

Create a persistent preview build:

```bash
vp run eas:ios:preview
```

Android equivalents:

```bash
vp run eas:android:dev
vp run eas:android:preview:dev
vp run eas:android:preview
```
