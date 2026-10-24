# 1top v2.1.1

The macOS companion now opens a standalone WKWebView desktop window. Its menu-bar icon opens a native compact dashboard with six usage periods, resource summaries, session controls, and account quota cards. Popover placement is clamped below the menu bar within the selected display, including vertically stacked monitors. Closing the desktop window keeps local monitoring running.

Aside internal sessions are discovered from its local read-only session index and incremental request reports. Active and recent 24-hour sessions are included; archived, incognito, and ephemeral sessions are excluded. Input, output, cache read, and cache write are counted without adding reasoning twice. Shared daemon resources are not attributed to individual sessions. Focus opens Aside; supported task interruption invokes its session stop command. Shared-app termination and automatic resume are disabled.

Claude Code and Codex quota cards display account-specific 5-hour and weekly provider reports, reset times, and freshness. Codex uses read-only app-server account RPCs, with window duration determining the quota period. Claude uses a matching account cache or authenticated usage report when available. Missing windows remain unknown, expired reports are not presented as current, and cached data is labeled. Remote reports omit email and credentials and use a bounded account identifier; the relay validates the quota fields again.

The v3.0.0 landing page presents the menu bar, desktop window, and quota views with illustrative data, download status, feature explanations, local-first onboarding, and English/Korean copy. The existing login and remote dashboard remain available to approved accounts.

## Verification and limits

72 Python tests, 23 relay tests and TypeScript checking passed. Native model checks cover unknown usage, freshness and supported controls; the full native app compiles and its local signature verifies. Native and browser validation do not execute stop or terminate against real AI work.

This remains a local ad-hoc macOS build. A public DMG requires Developer ID signing, notarization and first-run acceptance. Native iOS, public npm launcher, public paid checkout, automatic customer cloud provisioning and production-scale capacity validation are not shipped. Provider quota availability varies; no inference of a missing 5-hour window from a weekly value is made. Previous UI and installed app versions are retained in ignored local checkpoints; previous README versions are archived.
