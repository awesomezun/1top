# 1top mobile v1.0.0 preview

Native Android companion for your 1top workspace. This release includes an installable, signed APK for Android 7 and later.

- Sessions grouped by computer, with app, tool, model, activity and reported token rate.
- Usage windows: 24H, 12H, 5H, 1H, 30M and 10M. Tap map areas for the complete label and exact token count.
- Reported 5-hour and weekly account allowances, computer resources, and observed goals and skills.
- English and Korean interfaces, plus a clearly labeled built-in demo that needs no account.
- Optional remote access uses Google sign-in in the system browser and a revocable credential stored in the platform secure store. Remote access currently requires an approved account; public enrollment is closed.

Download `1top-1.0.0-android.apk` on the Android phone and open it. Android may ask whether to allow installation from the browser or file manager used to open this APK. The APK is distributed here, not through Google Play.

The mobile app views a computer running the 1top desktop collector; it does not collect desktop sessions directly from the phone. Remote controls require a fresh connected device and the session's reported capability. Demo controls do not operate real processes.

## Validation and limits

The exact signed release APK was installed and opened on an Android API 36.1 emulator. Session, usage, account and workspace screens, usage-map details, and language switching were exercised. TypeScript, Expo lint and three metric/geometry tests passed. The relay's authorization/revocation tests passed separately. A complete production Google sign-in and real-device remote-control flow has not yet been verified on a physical phone.

The iOS app also builds and archives. Public TestFlight/App Store distribution is pending the Apple team's App Store provisioning permission. This release does not include a publicly installable iPhone package.

SHA-256 checksums are attached. The mobile source for this APK is commit `59830a29f7d92feaaf776d94a4642744ff147847`.
