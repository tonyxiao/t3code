# Tony's private macOS releases

Build on macOS with Node 24.13.1, pnpm 11.10.0, Apple's command-line tools,
Rust, and the target architecture's Rust standard library. This fork's desktop
releases are independent of the public `t3` npm version.

From `/Users/claudia/hub`, run `bin/build-tony-t3-macos 1.0.0 arm64`.
The wrapper reads signing and notarization credentials from Bitwarden Secrets
Manager and calls `scripts/build-tony-macos.mjs`. It uses a temporary keychain;
it does not install, launch, or restart T3. Increment the desktop version for
subsequent releases. Intel builds use `x64` on a suitable Mac build host.

The build creates a signed, notarized DMG, updater ZIP, blockmaps, and
`latest-mac.yml` in `release/`. To publish the verified artifacts:

```sh
node scripts/promote-tony-macos.mjs release /Users/claudia/hub/projects/t3-distribution/site/macos
```

Promotion checks hashes, Tony's signing identity, the notarization staple, and
Gatekeeper acceptance. It keeps immutable version directories and replaces the
feed manifest atomically. It refuses version downgrades. Keep the ZIP and its
blockmap alongside the DMG; the macOS updater installs from the ZIP.

The feed is `https://cs-mini.meteor-ruffe.ts.net/t3-downloads/macos/`.
Tailscale must be connected for downloads and update checks. The static server
binds to loopback and is exposed with Tailscale Serve, not Funnel. Download
access follows the tailnet's existing access rules. Mac updates currently check
in the background and require explicit download/restart. Do not embed a shared
GitHub token or other download credential in the app.

The private build uses `com.tonyxiao.t3code.desktop`, the `tony-t3code` URL
scheme, `~/.t3-tony`, and a separate Electron user-data directory. It supports
direct server pairing. Hosted Clerk passkeys are disabled until this fork has
its own associated-domain configuration. Other builds keep upstream defaults.

The upstream release workflows also publish npm packages and hosted sites.
Use this private build script; do not push upstream-style release tags to
publish a private Mac build. Standalone remote servers continue to use their
own CLI/service updater; updating the Mac app updates its bundled server only.
