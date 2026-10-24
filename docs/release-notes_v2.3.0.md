# 1top v2.3.0 · Site v4.1.0

- The menu bar uses the existing waveform icon alone. Its tooltip reports connection and session status.
- Compact account cards place 5-hour and weekly allowances side by side. Four sample subscriptions fit in the native panel without scrolling; missing reports remain unknown.
- Account addition is available from the native panel and local dashboard. It opens the installed provider CLI's official login in Terminal and the browser, using a new private profile. Existing profiles are preserved. Claude Code enrollment requires version 2.1.310 or later. Codex uses file-backed credentials in its separate profile. Provider credentials stay local.
- Added profiles remain discoverable after the login process exits. Claude Code account usage can read the specific profile's macOS Keychain item, without enumerating Keychain.
- Existing session, AI, app, model, activity and system views remain available.
- The public landing page adds a visible grid, mint/blue/amber accents and motion. Desktop, menu-bar and account recordings remain separately visible, with pause controls and reduced-motion support. All public recording data is synthetic.

Validation: 81 Python tests, Swift model checks and native compilation. Fixture UI checks cover four visible quota cards, the additional-login dialog, retained filters and animation controls. Login launch/isolation is tested with mocked provider processes; completing a real new OAuth account requires the user's provider authentication. A public signed/notarized installer remains in preparation.
