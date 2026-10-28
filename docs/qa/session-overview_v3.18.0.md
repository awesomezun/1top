# Session overview and chart consistency — v3.18.0

This revision follows the installed v3.17.1 changes documented in [the prior QA record](passive-claude-and-overview_v3.17.1.md). Existing AI tasks were not restarted or stopped.

## Presentation

- CPU, memory, and known weekly account usage have thin, absolutely positioned bars within the existing summary rows. Row padding and height are unchanged; missing reports do not acquire invented values. Network and disk retain their numeric readings.
- AI and host-app tags follow first appearance in the actual displayed root-session order for the selected time period, including its 60-second rank stability. They are not sorted by session counts. One tag per row and second-click deselection remain intact.
- The six period buttons stay left aligned and use larger text, larger click areas, and stronger selected contrast.
- The sidebar uses the existing canonical waveform PNG unchanged. The local server serves the exact allowlisted image as image/png.
- Child groups remain collapsed by default; only explicit toggles expand them. The session model continues showing literal reported effort. The existing menu label remains unchanged; “개요” was recommended as a possible replacement.

## Shared token-flow contract

Native and web charts now use the snapshot timestamp, the same minute-aligned end boundary, and the same interval sizes: 60/60/60/300/900/900 seconds for 10m/30m/1h/5h/12h/24h. Canonical bottom-to-top provider order, palette, opacity, and 1/2/5/10 Y-axis maximum agree. The web legend follows that canonical order.

A single live numeric snapshot with 393 events was checked across both implementations. All six periods and all 304 bins matched in boundaries, provider values, stack order, and axis maximum. The chart resolutions are 10/30/60/60/48/96 bars.

## Claude session percentages

The three initially reported background sessions were already correctly associated with their account. Their valid 411.60-second provider-report interval had been excluded by a five-minute calibration cutoff intended for periodic polling. Claude statusline reporting occurs in response to activity.

Claude calibration now permits same-cycle report intervals up to one hour when account attribution existed before the interval, recorded token weights are available, and unbound events/corrections do not invalidate it. A calibrated estimate expires at the earlier of its weekly reset and 24 hours after the last eligible observation. It does not make an old account quota report fresh. Account identity, reset-cycle, correction, and provider-source guards remain in place. Stale Codex handling is unchanged. Historical source and observation date are available on hover rather than added to table rows.

The result remains a token-equivalent estimate, not provider-reported per-session billing. It cannot establish that another device had no usage. An inactive second Claude account still has no new calibration and retains its explicitly marked last quota report.

## Validation

- 273 Python tests passed, including eleven new Claude calibration cases.
- JavaScript renderer/click, weekly calculation, and map tests passed. Tests cover period-dependent tag order, unchanged compact-row geometry, missing/zero bars, historical calibration expiry/source/cycle/account checks, and six chart resolutions.
- Swift model checks and full native typecheck passed, including chart parity and bounded historical rate eligibility.
- Optimized macOS v3.18.0 build and strict ad-hoc signature verification passed. v3.17.1 remains in the versioned application backup.
- The installed collector reports v3.18.0. Served JavaScript/CSS/maps and waveform image match source byte-for-byte; the PNG also matches the canonical brand asset.
- Installed runtime showed four working Claude sessions with valid recent-hour estimates around 0.56–0.70%. Native/web presentation remained compact. The native UI and desktop view were visually checked; the desktop showed the waveform, enlarged period buttons, thin summary bars, period-based tag order, and collapsed groups.

Local evidence is retained in build/tests-v3.18.0.log, build/token-flow-parity-v3.18.0.json, build/runtime-qa-v3.18.0.json, and build/macos-build-v3.18.0.log. This is a local installation validation; no public notarization, Store submission, or hosted/mobile UI deployment is claimed.
