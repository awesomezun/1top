# 1top v3.19.3 — Editable dashboard (macOS preview)

The macOS desktop dashboard now combines computer resources, account limits, token flow, usage maps, and session controls in one view.

- Move and resize dashboard panels with **Edit**. Reorder table columns and resize them with visible handles; layouts are saved locally.
- Compare usage for 10 minutes, 30 minutes, 1 hour, 5 hours, 12 hours, or 24 hours. Hourly burn-rate gauges appear in their own column; memory uses percentages.
- Switch dark/light themes and Korean, English, or Chinese with animated transitions. The controls keep their positions across languages.
- Inspect model effort, group child sessions under their parent, toggle provider/app filters, and rename supported Orca terminals. Existing focus, pause, resume, and stop controls remain available according to session capabilities.
- Match menu-bar and desktop token-flow buckets and provider colors, use quilt-style usage maps, and display account history on a labeled axis.
- Avoid repeated background Keychain dialogs when collecting Claude usage. Passive reports and existing managed account credentials remain supported; unavailable reports are not shown as zero.
- Fix a Swift compiler type-check timeout in menu-bar session help text.

## Download

[macOS Apple Silicon DMG](https://github.com/awesomezun/1top/releases/download/v3.19.3/1top-3.19.3-macos-arm64.dmg) · macOS 13 or later.

SHA-256: `3f551f0612a3d5ef023cc46527ca318f5e4af9e56b8be68434b440cfba87626c`

This is an ad-hoc signed **preview**, without Developer ID signing or Apple notarization. macOS may block or warn about opening it. It is not a warning-free public installer and is not installed automatically. The normal release packaging path now requires verified Developer ID signing and stapled notarization; preview packaging must be selected explicitly.

The Windows Store release and iOS public distribution remain pending. Existing Windows and Android download status is unchanged by this macOS release.

## Validation

- 275 Python tests and the JavaScript quota, map, session, and relay suites passed.
- Both optimized macOS packaging and the unoptimized Swift compile used by CI passed.
- DMG integrity and the app's ad-hoc code-signature integrity passed.
- The collector inside the mounted DMG started successfully, reported v3.19.3, and served dashboard assets identical to the released source.

Code-signature integrity is distinct from Apple notarization and Gatekeeper acceptance.
