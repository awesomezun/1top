# 1top v3.19.4 — Desktop startup reliability (macOS preview)

This patch includes the [editable dashboard in v3.19.3](https://github.com/awesomezun/1top/releases/tag/v3.19.3) and fixes a startup issue exposed by Windows installation tests: concurrent script, style and font requests could exceed the local server's connection backlog, leaving the dashboard without its JavaScript dependencies.

The local server now accepts the startup burst. A regression test opens 32 simultaneous connections and checks every response against its source asset. Windows smoke failures also retain a diagnostic report instead of silently exiting.

## Download

[macOS Apple Silicon DMG](https://github.com/awesomezun/1top/releases/download/v3.19.4/1top-3.19.4-macos-arm64.dmg) · macOS 13 or later.

SHA-256: `9e2a44cfa665cfa44ae689268e46f29647dfbcddf086e5a849d1f3a3832d96dd`

**Preview:** the app has an ad-hoc integrity signature. Developer ID signing and Apple notarization are not complete, so macOS may block or warn about opening it. No automatic installation or Gatekeeper bypass is included. Background Keychain dialog suppression remains separate from Apple distribution signing.

Windows Store and iOS distribution remain pending. Existing Windows and Android download status is unchanged.

## Validation

- 276 Python tests passed, including the concurrent dependency startup regression.
- The preceding fix passed Windows EXE and installed MSIX validation in GitHub Actions run [40731780769](https://github.com/awesomezun/1top/actions/runs/40731780769).
- The macOS bundle and DMG built successfully, passed integrity checks, and reported v3.19.4 from the bundled collector.
- The collector from the mounted DMG served 32 concurrent asset requests with exact source contents.

Passing these checks does not certify an installer for Apple or Microsoft distribution.
