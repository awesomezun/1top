# Local dashboard and background credentials — v3.15.3

The local session view now uses one set of six period buttons, followed by token flow and a proportional quilt map, then the session table. Account consumption has its own navigation view. Its graph starts at the selected-period baseline with numeric axes; uncertain gaps and resets remain disconnected rather than implying a known timeline.

The native menu panel retains compact account summaries, CPU/memory, a token-flow chart with numeric axes, an always-visible two-dimensional map, and scrollable sessions. There is no quota-flow switch or separate account tab. Tool colors match the local web dashboard. Current panel size is 520 by 760 points, with three complete session rows and part of a fourth visible in the inspected layout. Individual session actions remain available.

## Session grouping and map behavior

Codex child threads are associated only through explicit session metadata. The collector exposes grouped root_sessions in addition to the original sessions. Child usage is counted once under its root, while parent resource and control identity remain unchanged. Child controls are disabled. Model grouping uses raw model identities. Filtering can reveal matching descendants, and parent resume controls follow the actual parent state even while a child is working.

Wide maps split into two proportional bands and recursively tile each band. This preserves exact areas while avoiding one continuous strip. Small cells remain inspectable; shared site map source is synchronized but the public site was not deployed in this update.

## Keychain correction and current limitation

The first SecItem query-only attempt was insufficient: the installed ad-hoc executable still triggered legacy login-Keychain dialogs. The final collector calls SecKeychainSetUserInteractionAllowed(false) before every read or update, retains per-query kSecUseAuthenticationUIFail, and fails closed if the process switch fails. It never re-enables interaction, calls the security CLI as a fallback, changes item ACLs, or modifies system security settings. Existing credential contents are neither logged nor migrated.

Installed v3.15.2 completed startup and a subsequent 120-second polling cycle with no credential dialog observed. Both Claude accounts returned credential_store_unavailable; Codex account reports advanced normally. Therefore this is evidence of prompt suppression, NOT of restored Claude account quota access. The same credential code is included in v3.15.3. These Claude profiles have no existing file credential fallback. Restoring fresh quota reads requires a stable signed caller with user-authorized access. Session/token log tracking remains independent of that access.

## Validation

- Python: 187 tests passed, including process-wide no-interaction ordering for reads and writes, failure-before-access, credential denial, existing managed-file refresh, explicit child ancestry, aggregate accounting, and weekly gap/reset intervals.
- JavaScript: weekly, maps, and session-groups tests passed; app.js syntax and git whitespace checks passed. Map tests cover exact areas, bounds, overlap, and multiple aspect ratios.
- Swift model checks, full native typecheck, optimized app builds, and deep strict ad-hoc signature verification passed.
- Live v3.15.2 native UI confirmed the account view, session ordering, and a two-band map at full window width. Previous v3.15.0 inspection verified the native always-visible chart/map and grouped sessions.
- v3.15.3 is installed at ~/Applications/1top.app. Prior versions are preserved in ~/Library/Application Support/1top/app-backups/; source archives and local sanitized runtime evidence are retained under ignored build/.

Scope: local macOS app and its local web dashboard. This is not a notarized public release. Windows Store, remote/mobile presentation, and fresh Claude quota authorization are not declared complete by this change.
