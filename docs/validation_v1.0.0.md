# Preview validation — v1.0.0

Checked on 23 October 2026. This records observed behavior, not a production capacity or universal compatibility claim.

## Automated checks

- 49 Python tests cover usage windows, process identity, resource attribution, terminal matching, control guards, payload minimization, credential permissions, and command deduplication.
- 13 relay tests cover account isolation, one-use connection tickets, device revocation, stale or changed session identity, unsupported capabilities, duplicate requests, and offline delivery rejection.
- TypeScript checking and the production web build pass in GitHub Actions.

## Browser and relay checks

- The public site is deployed through Sites; `https://1top.si/` and `/app/` return HTTP 200 over verified HTTPS.
- Google login and live account connections work on the public domain.
- Two synthetic companion clients were paired to one test account. A selected-client termination request reached only that fixture and returned its acknowledgement. The fixture controller did not signal any real process. Both fixtures were subsequently revoked.
- English/Korean navigation, rolling-window selection, the clearly labelled demo, desktop layout, and a 390 × 844 browser viewport were checked. A physical phone was not tested.
- One locally built macOS companion was connected through the Google sign-in flow. Its live dashboard showed 24 detected sessions; 19 had confirmed Orca terminal matches at the time of inspection. Counts change as sessions start and stop. Unconfirmed identities retained disabled controls.
- Restarting that companion reused its saved device credential and resumed reporting without another sign-in.

## Desktop distribution and remaining checks

- The Apple Silicon app builds, launches, and passes local ad-hoc signature verification. This is not Developer ID signing or Apple notarization.
- The public download remains unavailable until the distributable is signed, notarized, and tested as an actual downloaded application.
- The default browser opened the initial connection page. During DNS propagation an existing browser cache still reached the old domain destination and showed a certificate error. No certificate warning was bypassed. Verified HTTPS and the Google connection flow subsequently succeeded in Chrome.
- An old system-wide Orca launcher was discovered during native-app testing. The companion now prefers the current per-user Orca installation, while respecting an explicit `ORCA_CLI_COMMAND` override. Confirmed Orca terminal identities take priority over generic detached-process ancestry.
- Large-scale load, Windows/Linux companions, Intel Mac builds, all embedded IDE agents, provider billing reconciliation, and fresh-customer installer acceptance remain unverified.

No real AI session was interrupted or terminated during these deployment checks. No private transcripts, credentials, or real dashboard screenshots are included in this repository.
