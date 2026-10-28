# Passive Claude quotas and overview refinements — v3.17.1

Claude account sampling now consumes Claude Code statusline reports and non-secret account metadata. It does not read Claude credentials, refresh OAuth tokens, or call the subscription usage endpoint. The earlier background Keychain reader remains noninteractive for legacy callers, but is no longer part of normal account sampling.

## Account reporting

The statusline wrapper preserves the existing renderer and forwards its input unchanged. Only the two quota windows, hashed account identity, profile/session association, API-work counter, and observation timestamps are saved in quota reports. Separate session metadata stores the current model and effort when reported. Reports and integration specifications are private files. The reversible installer preserves original settings bytes, unrelated settings, and the original statusline command. New explicitly enrolled Claude profiles receive this integration automatically.

Initial callbacks may contain older CLI-cached data. They remain last reports until actual quota/API-work change is observed. Repeated cached callbacks do not become fresh samples. A profile/session cannot silently change account association. The collector also rejects a report contradicting that account's still-valid, previously verified weekly cycle. Previously verified local history can restore a missing weekly figure as a stale last report; it is never used as a fresh calibration sample. Reset windows expire normally.

Live installation captured statusline reports without opening a credential dialog. The displayed Claude weekly values were 4% and 12%. On the v3.17.0 runtime check, the first profile supplied an eligible fresh callback (5H 10%, weekly 4%); the second remained explicitly last-reported 12% from previously verified local history. This verifies the passive path and preserved values, not an independent live subscription API poll. New eligible Claude responses refresh their own reports. The statusline callback's available fields and first-response requirement are documented by [Claude Code](https://code.claude.com/docs/en/statusline#rate-limit-usage).

## Dashboard behavior

The session view remains the main overview. It adds one compact computer-resource row and one account-usage row above the existing period selector, flow chart, map, and session list. Account, map, resource, and activity views retain their detailed content. Account usage additionally contains a larger token-flow chart sharing the selected period. AI and host-app filters use capsule tags distinct from navigation, one tag per row. A second click clears that filter. Period buttons sit on the left next to the section heading. Child sessions start collapsed and only open through an explicit toggle; selecting a tag or search no longer expands children automatically.

Session ordering puts working groups first, including a working child, then compares selected-period cumulative token usage within each activity tier. It does not compare quota estimates with token counts or use instantaneous rate for the default order. Values continue updating; ranks within a tier are held for 60 seconds. Activity changes move a session to its new tier immediately. Period, search, filter, unit, and sort changes refresh ranks; new rows append and removed rows disappear without reshuffling existing peers. The native menu uses the same period-based, stable ordering.

Session usage cells show only the percentage and hourly rate, with calculation details available on hover. Token-only fallback remains a single amount.

Weekly account graphs use actual reported percentages, so a 100% latest report ends at 100%. Selected-period increases remain separate text. Displayed observations are joined by a continuous solid line without inserting zero values or extra observations. Numeric axes adapt to the displayed values.

A same-cycle reporting conflict previously produced 4→5→4 and falsely retained +1% spend. Raw database records are preserved. The derived series reconciles earlier overshoots against subsequent reports while always retaining the newest value. Correction-crossing intervals are excluded from flow and calibration; calibration restarts with clean later observations. Actual weekly resets remain separate. Read-only live replay at the 4% checkpoint retained raw 5% rows, displayed 4→4, produced zero net increase and no calibration. A subsequent genuinely new 5% callback remains visible as a new increase. Independent review found no blocking issue.

## Model effort

The session model label also displays its actual reported effort. Live runtime checks confirmed Codex ultra/xhigh, Claude and GLM xhigh/high, and Aside high/medium. Unreported values remain omitted; remote snapshot serialization preserves the same optional fields. Codex turn context, Claude Code statusline state, and explicit per-session host configuration remain distinct sources. Provider levels are preserved as reported rather than normalized into invented tiers. Missing values are omitted, and model changes invalidate old effort.

## Validation

- 262 Python regression tests passed, covering account separation, cycle conflicts, reset expiry, initial-versus-verified statusline data, idle duplicate freshness, renderer passthrough, reversible installation, private file permissions, and future account enrollment.
- JavaScript weekly and actual-renderer tests cover percentages, period ranking, 60-second order stability, resource/account rows, shared chart selection, tag selection, and unique element IDs.
- Swift model checks and native compilation preserve valid last-reported percentages while suppressing stale burn rates.
- Optimized macOS v3.17.1 build and strict ad-hoc signature verification passed. The installed collector reports v3.17.1; served JavaScript/CSS/map assets match source byte-for-byte. Previous application versions and original profile settings remain recoverable.
- Installed runtime verified current model effort and reconciled per-cycle graph values. Claude weekly values were 5% from a new eligible report and 12% marked last report; Codex Pro was 100% and Team 0%.
- Native UI confirmed grouped working sessions precede idle sessions, literal effort labels and compact percentage/hourly-rate rows. Desktop UI confirmed one tag per row and collapsed child groups. Real UI clicks switched Codex and Orca tags on and off; renderer event tests additionally exercise child expand/collapse and render polling.
- Weekly-history correction received an independent read-only review; no blocking issue remained. Raw historical samples were not deleted or rewritten.

Scope is the local macOS installation and local web dashboard. Existing AI sessions were not restarted, terminated, or replaced. No public notarized release, Store submission, or hosted-site deployment is claimed here.
