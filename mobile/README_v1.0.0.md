# 1top mobile v1.0.0

Native Expo / React Native companion for Android, iPhone and iPad. The app shows computers, sessions and their host apps/tools/models, usage and context maps, reported 5-hour/weekly allowances, resources, and observed goal/skill summaries. Map details open on tap. A clearly labeled demo works without signing in.

## Connection

The system browser opens 1top.si for Google sign-in. The mobile app creates a random credential locally, sends only its SHA-256 challenge through the browser, and stores the credential in SecureStore after authorization. Account grants are checked on every relay request. A 30-day maximum lifetime, a five-session cap, and logout revocation apply. Raw conversations and provider credentials are not part of the relay protocol.

Live connections reconnect when the app returns to the foreground or the network returns. Reports show their receipt time. Controls require a fresh report and a capability reported by the desktop collector; every action is confirmed, and offline actions are never queued or automatically replayed. “Open on computer” focuses the remote computer's app, not a local phone app.

Remote access currently requires an approved 1top account. Public remote enrollment and paid checkout are closed. Monitoring and native app installation do not include AI credits.

## Development

Use Node 22+, then `npm ci`, `npm run check`, and `npm run lint`. `npx expo start` runs the development server. Native projects are generated with `npx expo prebuild`; configure them through app.json and config plugins.

- Android: build the generated project with Gradle and a local Android SDK. Distribution APKs require a private release key; never publish a debug-signed build as a production APK.
- iOS: use Xcode and a valid development team for device installation. Simulator builds do not install on physical iPhones. Public TestFlight/App Store distribution additionally requires valid Apple signing and App Store Connect setup.
- EAS profiles are supplied for contributors who prefer builds under their own Expo account. No shared EAS account or project is provisioned by this source.

The production relay is fixed to the 1top service; this first mobile preview is not a self-hosted relay selector. Additional AI-account login happens on the desktop computer.

## Evidence and boundaries

`test/metrics.test.mjs` covers unknown/zero/stale separation, last-input context semantics, and treemap area preservation. Cloud tests cover account isolation, grant admission, replay protection, expiry, session caps and credential/ticket/socket revocation. Native build and device evidence is tracked separately from these unit tests.

The Expo CLI dependency tree currently reports upstream build-tool advisories in node-forge/zod. Those CLI tools are not part of the native JavaScript application bundle; follow upstream fixes without downgrading Expo to an incompatible SDK.

See [the pinned T3 Code architecture benchmark](../docs/research/t3code-mobile_v1.0.0/benchmark.md) for the reference study. 1top keeps its existing Firebase/Cloudflare authentication and monitoring protocol.
