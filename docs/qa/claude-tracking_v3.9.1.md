# Claude tracking correction, v3.9.1

## Changes

- Normalize Claude Code registry `busy` and `shell` to `working` on macOS and Windows. Retain reported idle/waiting states; token activity is not a turn-state proxy.
- Read whitelisted process environment fields directly so profile directories containing spaces remain intact. Resolve transcript identity within that profile and reject ambiguous paths.
- Refresh expired logins only for profiles enrolled under 1top's account directory. Preserve granted scopes, serialize refreshes with an OS lock, check account identity before persisting, and retain rotated refresh tokens in the existing credential store. Other Claude profiles remain read-only.
- Use bounded provider requests with fixed HTTPS endpoints, no redirects, and explicit client/Accept headers. Never put credentials in subprocess arguments or returned account rows.
- Keep the last successful in-memory quota on temporary failure. Report storage access, expired login, rate limit, and provider failures separately. Deduplicate successful account queries across profiles.

## Validation

- 148 Python tests pass, including profile isolation, directories with spaces, concurrent refresh, account switching, token rotation, stale data retention, and locked Keychain diagnostics.
- Native Swift model checks pass. macOS arm64 app builds with the installed macOS 26.5 SDK. The default macOS 27 SDK currently fails to load SwiftUIMacros with the installed command-line toolchain; no application source workaround was introduced.
- A read-only real-session discovery observed 14 Claude-runtime sessions, all reporting idle at that checkpoint. Busy/shell transitions are covered by regression fixtures, not by sending a new task to a user's session.
- Independent replay of the reported session matched all four live cumulative counters (fresh input, cache read, cache write, and output). This validates that session's cumulative count, not every historical usage source.
- Actual provider requests returned both Claude accounts and both Codex accounts as fresh. After app replacement, reads of the second Claude account's Keychain item started timing out. Installed-app quota acceptance remains blocked on the owner's macOS Keychain authorization; a successful source-level request is not presented as installed-app acceptance.
- v3.9.0 and v3.9.1 local builds are preserved. The previous installed v3.7.0 app and usage database were backed up before replacement. These are ad-hoc signed local builds, not notarized public releases.

## Concurrent work

Reviewed the other in-progress Claude patch and reused its registry-state mapping and Windows call site. The original 13-file patch and worktree remain unchanged. Its missing-log-as-zero behavior and unfinished price-weighted allocation of weekly allowance were not included: an absent report is not evidence of zero, and price-weighted token shares are not provider-reported per-session quota usage.

The Microsoft Store preparation branch and its unresolved certification evidence were not modified. This patch has not been published as a consumer release.
