# Dashboard controls polish — v3.19.2

Follow-up to [v3.19.1](digital-dashboard_v3.19.1.md):

- Reserve a fixed width for connection status and the Edit button, so Korean, English, and Chinese labels do not move the theme/language controls.
- Remove the hourly/minute selector. Burn-rate gauges now always display percent per hour. Previously saved minute preferences are ignored without resetting other layout settings.
- Show a permanent bordered `↔` grip at each column boundary. The grip has a resize cursor, translated drag instruction, keyboard operation, and a visible hover/focus state.
- Remove the sidebar “This computer / 무료 로컬 워크스페이스” block. The logo leads directly into navigation.

The browser regression suite verifies stable control X coordinates across languages, hourly output after loading an old minute preference, visible grips and actual mouse resizing, absence of the removed block, and the prior layout, theme, animation, hierarchy, and control behavior. JavaScript session renderer tests and the optimized Swift/macOS build also passed. Backend code is unchanged from the 275-test v3.19.1 baseline.

Local evidence: `build/dashboard-browser-v3.19.2.json`, `build/dashboard-default-v3.19.2.png`, `build/session-ui-v3.19.2.log`, and `build/macos-build-v3.19.2.log`.
