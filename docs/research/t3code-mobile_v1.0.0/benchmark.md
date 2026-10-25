# 1top mobile benchmark v1.0.0

Reviewed 2026-10-24. Upstream commit: `d53873b6a4799e87afd63c8d288ef0089f5a3748`.

This is a bounded source and public store review. The upstream native app was not installed or executed, no account was used, and reconnect/security behavior was not exercised. Source files and hashes are recorded in [source-map.json](source-map.json). Recommendations below are proposed 1top work, not claims that 1top already implements them.

## Architecture decision

T3's mobile product is a native React Native/Expo application. At the reviewed commit it declares Expo 58.0.14, React Native 0.88.0, React Navigation native stacks, Clerk's Expo/native authentication, secure storage, SQLite, and custom Swift/Kotlin modules. It also has a WebView dependency for embedded content; that does not make the main app a website wrapper. [Package source](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/package.json#L51-L149)

For 1top, use a native mobile client with shared data contracts. Expo/React Native is the closest architectural match to T3; separate SwiftUI and Kotlin native clients can implement the same behavior if those toolchains are preferred. Retain 1top's existing Firebase and relay rather than migrating authentication merely to match T3. A browser container can be an explicitly labeled interim client, but should not be described as equivalent to T3's native experience.

## Observed patterns and 1top adaptations

| Area | Observed in T3 source | Proposed 1top adaptation |
| --- | --- | --- |
| Navigation | Native sections for threads, pull requests and usage, with platform-specific headers and adaptive workspace layout. | Sections for Sessions, Usage, Accounts and Settings. Keep a computer selector available above the selected section. Use a detail stack on phones and list/detail panes on tablets. |
| Session rows | Public Android screenshot emphasizes project identity, large task title, secondary location metadata, and visible working/approval states. | Large session title, explicit working/waiting/idle status, then separate host app, execution tool and model. Do not flatten Aside/Orca and Claude Code/Codex into one category. |
| Sign-in | Native Clerk AuthView and UserProfileView; account activation and logout clean up cloud environments, relay token state and notification registration. | Use native/system-browser OAuth for the existing 1top account. On account switch, close old sockets and clear old device/session caches before rendering the next account. |
| Onboarding | Managed account environment discovery and a separate direct pairing screen with QR scanner, address and code. | Show existing linked computers after login. An empty account needs an explicit desktop-install/connect step. Add QR pairing only with a complete authenticated companion endpoint; the current loopback server is not remotely reachable. |
| Deep links | Production pairing screen ignores automatic host/token prefill from route parameters; development automation has a separate opt-in. | Deep links should navigate, not silently trust or connect to an arbitrary supplied server. Validate origin, expiry and proof of possession before connection. |
| Credentials | Connection catalog and credentials go through expo-secure-store; a SQLite-backed cache serves application state. | Keep credentials in Keychain/Keystore. Store bounded monitoring snapshots separately with account/device identity and receipt timestamp. |
| Reconnection | Network listeners detect online/offline changes and Wi-Fi/cellular transitions. Returning after at least 10 seconds in the background requests a reconnect; shorter absences request a probe. | Refresh on resume and network-path changes. Use retry backoff and a clear last-received timestamp; never present a stale report as live. |
| Failure presentation | Dedicated offline, connecting, reconnecting and failure notices, with retry controls. | Preserve readable last-known data while showing connection state. Disable controls while offline/stale; do not queue stop/terminate commands for later execution. |
| Usage | Native usage navigation and optional subscription-usage widgets exist. | Bring 1top's six rolling periods, session/app/tool/model maps and compact 5H/weekly cards into native screens. Preserve unknown values and context-capacity limitations. |
| Distribution | Separate development, preview and production app identities; internal APK profile, production submission configuration, TestFlight profile and runtime fingerprint policy. | Build self-contained installables, separate preview from production, and expose platform-specific download availability. Never link a dev-client binary that still requires a local bundler as a normal installer. |

Source pointers:

- [Native navigation sections](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/workspace/navigation-tab-order.ts#L1-L23), [platform headers](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/workspace/WorkspaceRootScreen.tsx#L140-L190).
- [Native auth/profile screen](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/settings/SettingsAuthRouteScreen.tsx#L33-L65), [account cleanup/activation](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/cloud/CloudAuthProvider.tsx#L85-L172).
- [QR pairing and guarded route prefill](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx#L38-L70), [explicit scan and connect handling](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx#L109-L166).
- [Secure storage wrapper](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/persistence/mobile-secure-storage.ts#L31-L50), [catalog persistence](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/connection/catalog-store.ts#L51-L117), [SQLite cache tables](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/persistence/mobile-database.ts#L256-L285).
- [Network-path and lifecycle wakeups](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/connection/platform.ts#L85-L152), [10-second background threshold](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/connection/app-state-wakeups.ts#L1-L18), [connection notices and retry](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/src/features/connection/EnvironmentConnectionNotice.tsx#L13-L95).
- [Build profiles](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/eas.json#L5-L85), [runtime policy and platform configuration](https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/apps/mobile/app.config.ts#L225-L279).

## Scope for the first usable 1top mobile release

1. Native sign-in, signed-out state, demo entry and an honest empty-computers state.
2. Computer picker plus Sessions, Usage, Accounts and Settings screens. Session detail exposes the existing supported controls with target confirmation.
3. Freshness-aware live connection, background/resume recovery, explicit offline state, and account-isolated secure persistence.
4. Six usage windows and reported context composition. Do not invent file-by-file context or turn unknown provider quotas into zero.
5. Android APK built and installed on an emulator/device; iOS simulator build and a distribution archive. Actual iPhone distribution must use valid signing/provisioning and the selected TestFlight/App Store or registered-device path.
6. Landing-page buttons point to real artifacts or store/testing URLs, with version, platform, architecture, checksum and preview status. Keep the source ZIP visibly separate from an installer.

Native widgets, push alerts, file editing, terminal emulation, pull-request workflows and T3's extensive custom editor modules are not prerequisites for a monitoring/control release. T3's architecture is evidence of product scope, not a reason to import every dependency. Metered server-side push/history work should remain behind the existing managed-access policy.

## Distribution evidence and inconsistency

The pinned mobile README still says the mobile app is not distributed. That statement is stale: the root README links both stores, and the public [Apple App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) and [Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code) listings were accessible during this review. Both describe manual pairing and managed T3 Connect. Store availability does not prove a particular source checkout matches a released binary.

The Android store screenshot was visually inspected. It is a static marketing artifact and may show an older build; it is not runtime verification. No upstream screenshot, icon, certificate, account identifier, private token or native implementation is copied into 1top by this review.

If implementation code is later reused from the MIT-licensed repository, retain the applicable copyright and license notices and review the licenses of any vendored third-party modules separately.
