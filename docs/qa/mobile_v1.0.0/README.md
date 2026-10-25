# Mobile v1.0.0 validation

Date: 2026-10-24. Mobile source: `59830a29f7d92feaaf776d94a4642744ff147847`.

## Android

- Release Gradle build succeeded; final APK signed with the project upload key kept outside the repository.
- APK signature verification: v2 and v3 passed. Package `si.onetop.mobile`, version 1.0.0, minimum API 24.
- Installed the exact signed APK on `Medium_Phone_API_36.1`, opened the native sign-in screen, and entered the built-in demo.
- Exercised Sessions, Usage, Accounts and Workspace. The usage map's website area opened full details: 310,000 tokens, 55.36%, MacBook Pro / Cursor / Frontend / Claude Code / claude-sonnet-4-6.
- Verified the 24H/12H/5H/1H/30M/10M choices, separate unknown usage count, and reported account 5H/weekly windows.
- Switched the interface from English to Korean. Screenshots in this folder contain synthetic demo data only.
- `npm run check` and `npm run lint` passed. The three metric/geometry tests passed.

## iOS

- Simulator Release build and signed device archive succeeded.
- Development IPA export succeeded for the team's registered device; this private development artifact is not included in the public release.
- App Store export failed because the current Apple team cannot create iOS App Store provisioning profiles.
- The unsigned simulator launch displayed the sign-in UI but could not access SecureStore. Subsequent simulator signing did not produce a runnable app. iOS runtime login and UI interaction remain unverified.

## Web and relay

- Relay v1.5.0 deployed with mobile credential hashing, approved-account gating, expiry and revocation. Public pairing remains disabled.
- Twenty-nine relay tests and TypeScript checks passed before deployment.
- Browser checks confirmed invalid mobile connection requests are rejected and valid-shaped requests show Google sign-in and explicit connection consent.
- End-to-end production Google sign-in, physical-phone behavior and real remote control remain unverified. Emulator demo validation does not prove those paths.
