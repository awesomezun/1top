# 1top v3.4.1 — connection and release readiness

- Prefer the current macOS Keychain credential for Claude Code account limits, fixing stale legacy credentials masking an active sign-in.
- Add explicit custom-relay selection on web, macOS, Windows, and mobile. Saved device credentials are scoped to their relay; redirects cannot forward pairing credentials.
- Add an owner-only Cloudflare deployment helper that provisions its own database and relay. A separate disposable deployment was created and verified during QA.
- Add Stripe Checkout, subscription portal, verified webhooks, and server-derived entitlements. Managed billing and new managed enrollment remain closed until commercial configuration and live checkout validation are complete.
- Reduce unattended reporting from every 3 seconds to every 60 seconds; return to 3-second updates when a viewer connects.
- Add bounded Codex Skill-read observations and read-only Claude Code persistent schedules. These are partial observations, not proof of workflow success or a complete inventory of session-only loops.
- Add daily update checks and release links. Unsigned preview builds are not installed automatically.
- Add Developer ID/notarization and Windows publisher-signing scripts. Production signing still requires valid account credentials/certificates.

## Validation

107 Python tests, 52 relay tests, web/map boundary checks, Swift compilation/model checks, and mobile TypeScript/lint checks pass. A local workerd load fixture delivered 500 snapshots across 25 accounts, 50 devices and 25 viewers with account isolation; mean 16.7 ms, p95 29 ms for 30 synthetic sessions per device. This is not a production capacity claim. A 20-sample local desktop baseline is included in the measurement screen.

Artifacts remain preview releases until macOS notarization and Windows publisher signing are completed. Mobile v1.3.0 adds custom relay selection. iOS installation and launch on a physical phone were verified for the previous v1.2.0 development build; physical login/control and store distribution remain separate validation steps.
