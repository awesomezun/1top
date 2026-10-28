# Unified menu dashboard — v3.12.0

The menu panel now combines subscription summaries and sessions in one view. It removes the separate accounts tab, retains account login from the plus menu, and opens 5H/weekly limits and reset times when an account card is clicked. Claude Code uses #bd8965 and Codex #378d76, matching the full local dashboard. CPU, memory, session controls, and the token share map remain available. Main session labels use 15pt type and locations 13pt.

The 480×740pt panel places a compact flow chart beside the share map. Token mode stacks reported token quantities by tool. Weekly mode shows one selected account's observed quota increases in percentage points, with missing reports distinguished from zero. Account limits are never summed. Accounts with unavailable credentials show their status rather than a current burn rate. The chart defaults to the account with the greatest observed consumption and supports explicit account selection.

Account burn rate is observed percentage-point increase × 3600 / observed seconds, including partial-period coverage. At least 120 observed seconds are required. Session burn rate is an explicitly approximate current token-rate equivalent using the last 60-second average and that account's calibration. It is not a prediction of exhaustion or exact provider charging.

The full local web dashboard places the token-flow chart immediately above the session table. Six period buttons replace the dropdown and share the same selection with summaries, maps, and session totals. The chart height is 180px on desktop and 160px on small screens.

## Validation

- 171 Python tests passed. New flow regressions preserve 240 intervals over eight hours even when the cumulative history is thinned to at most 96 points, and exclude quota resets, corrections, and sampling gaps over five minutes.
- Swift model checks cover actual observed duration, missing versus zero rates, finite numeric guards, calibration/account isolation, stacked token totals, chart boundaries, unthinned flow precedence, and legacy optional decoding. Full Swift typecheck and optimized native build passed.
- JavaScript weekly, map, relay tests, app syntax, and git whitespace checks passed.
- Live web DOM verification exercised all six chart buttons and checked synchronization with overview/map/table, chart placement before the session table, absence of the old dropdown, and no button overflow. Evidence: ignored local build/chart-buttons-v3.12.0-dom.json.
- Installed ~/Applications/1top.app reports version 3.12.0. All four served web assets match the reviewed source. Live API returned four account flows with no invalid interval durations or negative deltas.
- Native visual verification showed four complete session rows plus part of a fifth, four account cards, CPU/memory, flow chart, and the share map. Token colors, weekly-mode switching, account selection identity, and the clicked account's 5H/weekly detail were inspected. Actual session rows stay scrollable. Longer project names truncate with full detail on hover.
- Previous app and SQLite snapshot are preserved in ~/Library/Application Support/1top/app-backups/v3.11.0-before-v3.12.0/. Source archives are retained under ignored build/.

Scope: installed local macOS app and its web dashboard. This is a local ad-hoc signed build; public notarized releases, Windows Store, remote dashboards, and mobile presentation were not released by this update.
