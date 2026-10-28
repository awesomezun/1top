# Weekly quota usage — v3.10.3

The local dashboard and macOS menu panel now default to provider-reported weekly account percentages. Each account has its own 100% denominator. The token view, token map, resource indicators, session controls, and account-limit tab remain available.

## Measurement

- Account current usage and reset time come from existing authenticated provider integrations. Stale values are labelled; unavailable accounts never become 0%.
- Rolling 24h, 12h, 5h, 1h, 30m and 10m figures are observed percentage-point increases. They start with the new collection history, not lifetime-token conversion. A lone sample is unknown.
- Session figures are explicitly estimates: allocate each account's observed increase over the same sampling interval in proportion to locally observed total tokens (including cache). This is not provider billing attribution. Model/cache weights, delayed reports, and use on other computers can affect the estimate. Different accounts' percentages must not be added.
- Events acquire a profile-based account hint only when their event time is at or after that profile identity was first observed. Previously unbound events stay unbound. Profile identity changes restart that horizon. Sessions observed under multiple accounts are omitted from single-account estimates.
- Reset intervals, long sampling gaps, missing token reports, and unsettled final intervals remain unallocated. Boundary-crossing observations are excluded rather than prorated. Incomplete periods are labelled partial. Provider rounding can produce a reported zero increase even while tokens are consumed.
- SQLite migration adds a nullable account column and a separate weekly-sample table. Weekly samples retain eight days; charts expose bounded points for the latest day. No conversation content or credentials enter the new table.

## Validation

- Python: 163 tests passed, including 15 new cases covering attribution, migration, boundaries, resets, account switches, missing reports, stale/future samples and proportional estimates.
- JavaScript: weekly formatting, map accounting/layout and relay-boundary checks passed. Browser rendering confirmed token-mode restoration, all six periods, account cards, and a synthetic 0.75% estimate.
- Swift: complete source typecheck, model checks with backward-compatible optional fields, and optimized macOS 13+ arm64 app build passed using macOS 26.5 SDK. Local ad-hoc signature verified.
- Installed v3.10.3 at ~/Applications/1top.app. Previous v3.9.1 and v3.10.0 apps and database snapshots are preserved under Application Support/1top/app-backups. The pre-feature UI source archive is in build/ui-before-weekly_v3.9.1.tar.gz.
- On-device initial verification: three fresh account reports (Claude Code 4%, Codex Pro 26%, Codex team 0%). A later live check recovered the second Claude account at 12%; all four accounts were fresh. Codex advanced to 28%, with observed session shares 0.4186, 0.2638, and 0.1532 percentage points. Fresh records and estimates persist across app restarts. These are partial-period estimates, not full historical reconstructions.

A subsequent runtime sample identified a Keychain credential-write call waiting inside Security.framework. Profile requests now have a bounded foreground wait and one in-flight worker per profile; a regression test proves a blocked Claude profile does not stop Codex sampling or spawn duplicate requests. This does not grant or bypass Keychain access.

The final patch replaces indefinite session "measuring" placeholders with raw-token fallbacks and specific reasons: account connection needed, quota query pending, or next quota report pending. Idle zero-use accounts with moving reset dates report a partial observed zero instead of remaining unknown.

## Scope

This is a local dashboard and macOS companion update, not a public signed release. Public landing-page/mobile/relay payload changes and Microsoft Store submission are separate. No AI-session messages or stop commands were used for testing. The earlier Claude worktree and unfinished patch are preserved unchanged.
