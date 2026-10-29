# 1top v4.0.2 — Cockpit and mobile remote controls

The redesigned cockpit is available across the Mac menu bar, desktop dashboard, web, and mobile. It includes hourly token speed, model shares, account limits, working-session-first ordering, compact usage heatmaps, and two-column usage panels.

Claude usage remains associated with the session's original account after profile changes. Background limit sampling verifies provider identity and can use a one-time, explicit Keychain connection without opening authorization dialogs during normal collection. An older failed profile no longer prevents another enrolled profile for the same account from refreshing usage.

Local history imports Claude, Codex, and supported in-app records with fork deduplication. Opt-in OTLP collection supplements local records. The relay carries bounded cockpit data and session controls; provider credentials are kept on the collecting computer.

Native iPhone and Android screens include session messages/replies, instructions, pause/resume/quit, receipts, computer selection, account limits, usage views, and workspace settings. Replies are matched to the requested device and session; computers paired without remote control do not offer command buttons.

## Downloads

- macOS Apple Silicon: `1top-4.0.2-macos-arm64.dmg`
- Windows x64: `1top-4.0.2-windows-x64-setup.exe`
- Windows validation package only: `1top-4.0.2.0-windows-x64-test.msix`
- Android 4.0.0 (9): `1top-4.0.0-android.apk` and `.aab`
- SHA-256 checksums: `SHA256SUMS.txt`

The desktop/collector release is 4.0.2; the mobile app versions are 4.0.0. Android retains the certificate used for the previously distributed APK, so updates preserve app data.

## Validation and distribution limits

- 349 Python tests; Swift desktop checks; web, relay and mobile CI passed.
- Windows: four installed EXE scenarios and seven installed MSIX/update scenarios passed in [run 40848420508](https://github.com/awesomezun/1top/actions/runs/40848420508).
- The final Mac app was installed and relaunched. All four connected account limits refreshed successfully, including a subsequent automatic poll after the duplicate-profile fix.
- iPhone 15 Pro Max: physical-device tests passed for launch, sign-in persistence, live updates, reconnect, screen navigation, instructions, questions/replies, pause, resume, quit and command receipts.
- The 69 frozen frontend file checksums match `frontend-freeze_v1.9.0.sha256`.
- Android: signed APK update installation and cockpit, session detail, confirmation and demo receipt were checked on an API 36.1 emulator. No physical Android device was available.
- macOS uses an ad-hoc integrity signature and is not Developer ID signed or notarized. Windows EXE is unsigned; the MSIX is test-signed and is not Microsoft Store certified.
- Native iPhone development installation uses a Personal Team. App Store/TestFlight distribution requires Apple Developer Program enrollment; no public iPhone installer is claimed here.
- Desktop artifacts were built from `61da6c7b1af63473ac9023a4b73bc9675232d1e7`. Later commits add iPhone UI fixes, website download metadata and verification records without changing the desktop or Android binary sources.
