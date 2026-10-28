# Selected-period quota equivalents — v3.11.0

## Defect

v3.10.3 used a short interval's allocated account quota increase as the session's primary percentage, but displayed the whole selected period's tokens beneath it. Selecting 30 minutes or 24 hours could therefore show the same 0.42% beside different token totals. The partial label did not explain the mismatch adequately.

## Change

Account cards retain provider-reported weekly usage. Session percentages are now explicitly **token equivalents**, calculated as:

`selected period reported session tokens × (eligible observed account percentage-point increase / eligible observed account tokens)`

The percentage and its displayed token basis cover the same selected period. The coefficient is per account and applies only to the current observed quota cycle. A minimum 1 percentage point of movement and 120 seconds of eligible observations are required; a short baseline is labelled early. Zero-movement intervals contribute their tokens to the baseline. Stale accounts, reset/correction intervals, long sampling gaps, unsettled tails, and intervals with unbound same-provider activity do not calibrate a new coefficient.

This is a rough current-account equivalent, not historical provider billing attribution. Model and cache composition, reporting precision and external usage affect it. Unattributed historical tokens may be converted under the current profile only with that explicit meaning; their database account identity remains NULL. A session observed under conflicting account identities is not converted. Lifetime tokens outside the selected period never enter the calculation.

The web row shows its selected-period token basis and calibration duration; the tooltip includes the observed percentage and token denominator. The menu panel labels the result as an equivalent and exposes the calculation on hover. Account-period increases also show observed duration when coverage is partial.

## Verification

- 169 Python tests passed, including the regression with 10M tokens in 30 minutes, 57M in 24 hours and a separate 230M outside 24 hours. At a 1%p/3M-token baseline, the results are 3.3333% and 19%, not an identical short-interval share.
- Tests cover zero-change calibration, zero-growth intervals, partial account-token coverage, stale data and cross-account isolation.
- JavaScript formatting/map/relay checks, Swift model checks, full native typecheck, optimized app build and local signature verification passed.
- Installed API: zero mismatches between each estimate token basis and the corresponding rolling token vector. Browser period switching on one live session produced 4.78M → 0.958% (10m), 11.96M → 2.395% (30m), and 58.31M → 11.6817% (24h) in one snapshot. Native menu switching to 24h also changed the displayed percentage and preserved account cards, map and resources.
- Installed app: `~/Applications/1top.app`, v3.11.0. Prior v3.10.3 app, SQLite snapshot and UI/source archive preserved.
- Scope: local web dashboard and macOS app. This does not publish a signed release or change the remote/mobile payload.

An older Windows CI run for v3.10.3 failed to generate the cold-start smoke report. Agent, web and mobile checks passed; Windows installed-app acceptance remains unconfirmed for this feature branch and is not represented as a successful release here.
