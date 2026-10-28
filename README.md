# 1top

**Your AI work. In view.** Your AI agents, sessions, tokens and computers, together in one place.

[Website](https://1top.si) · [Try the demo](https://1top.si/app?demo=1) · [Screenshots](#screenshots) · [Download](#download) · [Release notes](docs/release-notes_v3.6.0.md) · [한국어](README.ko.md)

<!-- gitreels:start -->
<p align="center">
  <a href="https://gitreels.com/awesomezun/1top"><img src="https://gitreels.com/awesomezun/1top.webp" alt="awesomezun/1top in 15 seconds" width="100%"></a>
  <br>
  <a href="https://gitreels.com"><img src="https://gitreels.com/badge.svg" alt="Made with GitReels" height="24"></a>
</p>
<!-- gitreels:end -->

See which computer, application, and terminal owns a session; inspect reported token usage and CPU/RAM; send supported controls to the selected session.

**Status: early preview.** The browser demo is available without installation. Download the macOS Apple Silicon DMG or Android APK [below](#download) or from the [download page](https://1top.si/#download). The Mac app is locally signed but not notarized; Windows is moving to Microsoft Store MSIX distribution and is not yet published there. Android is distributed as a signed preview APK. iOS store distribution and clean-machine installer acceptance remain pending. Broad process detection does not imply every tool exposes tokens or supports pause/resume.

## Screenshots

### Website

[1top.si](https://1top.si) opens with a 24-second overview of what 1top does.

![1top.si landing page](docs/readme/v3.6.0/en/landing.jpg)

| Sessions from many apps and computers gather in one view | Switch the time window and every number follows |
| --- | --- |
| ![Sessions scene](docs/readme/v3.6.0/en/motion-1-sessions.jpg) | ![Usage scene](docs/readme/v3.6.0/en/motion-2-usage.jpg) |
| **Token maps show where your usage goes** | **Every subscription's limits, side by side** |
| ![Token map scene](docs/readme/v3.6.0/en/motion-3-token-map.jpg) | ![Account limits scene](docs/readme/v3.6.0/en/motion-4-limits.jpg) |

Click the 1top icon in the macOS menu bar and jump straight back to a session:

![Menu bar scene](docs/readme/v3.6.0/en/motion-5-menu-bar.jpg)

### Dashboard

These come from the [browser demo](https://1top.si/app?demo=1), which uses example data and controls no real device.

![Dashboard: computers and rolling token usage](docs/readme/v3.6.0/en/dashboard.jpg)

| Usage share map | Sessions and where they run |
| --- | --- |
| ![Usage share map](docs/readme/v3.6.0/en/usage-share-map.jpg) | ![Sessions table](docs/readme/v3.6.0/en/sessions.jpg) |

| Account limits: 5-hour and weekly windows | Session messages |
| --- | --- |
| ![Account limits](docs/readme/v3.6.0/en/account-limits.jpg) | <img src="docs/readme/v3.6.0/en/session-messages.jpg" alt="Session messages with a reply" width="360"> |

### macOS app

Recorded from the native app with example data (Korean UI).

| Desktop dashboard | Usage share map |
| --- | --- |
| ![macOS desktop dashboard](site/public/media/v4.6.0/desktop.jpg) | ![macOS usage share map](site/public/media/v4.6.0/maps.jpg) |

| Menu-bar summary | Menu-bar account limits |
| --- | --- |
| <img src="site/public/media/v4.5.1/menu.jpg" alt="Menu-bar summary panel" width="320"> | <img src="site/public/media/v4.5.2/accounts.jpg" alt="Menu-bar account limits panel" width="320"> |

### Android

| Sessions | Usage share | Plan limits |
| --- | --- | --- |
| <img src="docs/qa/remote-instructions_v3.5.0/1top-android-working-first.png" alt="Android sessions" width="240"> | <img src="docs/qa/usage_only_v3.3.0/android-usage.png" alt="Android usage share" width="240"> | <img src="docs/qa/mobile_v1.0.0/android-accounts.png" alt="Android plan limits" width="240"> |
| **Session messages** | **Instruct an AI session** | **Workspace** |
| <img src="docs/qa/session-mailbox_v3.6.0/1top-android-mailbox.png" alt="Android session messages" width="240"> | <img src="docs/qa/remote-instructions_v3.5.0/1top-android-instruction-result.png" alt="Android AI instruction" width="240"> | <img src="docs/qa/production-readiness_v3.4.1/android-settings.png" alt="Android workspace settings" width="240"> |

## Download

Windows v3.8.0 adds Microsoft Store MSIX packaging. Store registration and certification are pending; there is no public Store installer yet. [Distribution details](docs/windows-store_v3.8.0.md). The [previous unsigned EXE preview](https://github.com/awesomezun/1top/releases/tag/v3.7.1) remains archived.

| Platform | File | Notes |
| --- | --- | --- |
| macOS (Apple Silicon) | [1top-3.19.4-macos-arm64.dmg](https://github.com/awesomezun/1top/releases/download/v3.19.4/1top-3.19.4-macos-arm64.dmg) | Ad-hoc signature; Developer ID signing and notarization pending. SHA-256 `9e2a44cfa665cfa44ae689268e46f29647dfbcddf086e5a849d1f3a3832d96dd` |
| Windows x64 | Microsoft Store · in preparation | MSIX packaging; publication requires account verification and Store certification. |
| Android | [1top-1.5.0-android.apk](https://github.com/awesomezun/1top/releases/download/mobile-v1.5.0/1top-1.5.0-android.apk) | Signed preview APK. SHA-256 `db4ba91ac0bb91bd0e1686b54432db14388993a092d35215f18cba6790d777c9` |
| iOS | — | Native build ready; TestFlight/App Store distribution pending |

All releases: [v3.19.4](https://github.com/awesomezun/1top/releases/tag/v3.19.4) · [mobile-v1.5.0](https://github.com/awesomezun/1top/releases/tag/mobile-v1.5.0). Preview downloads are not production-signed installer acceptance evidence.

## Using 1top

The default flow is **open 1top → desktop dashboard**. Click the menu-bar icon for the compact dashboard and account limits; use **Open full dashboard** for the standalone desktop window. Local monitoring is free and requires no login or cloud relay. Keep 1top running in the menu bar. Optional **Open at login** starts it after you sign in to macOS.

Remote access is optional. Managed access currently requires a server-issued grant; public device enrollment and public paid signup are closed. Google sign-in alone does not create remote access. A previously linked operator device keeps its existing connection. Customer-owned cloud setup is planned; there is no automated provisioning flow yet. See [service policy](docs/service-policy_v1.0.0.md).

A browser login cannot inspect or control arbitrary local processes. The companion provides that local connection. Nothing is installed on a phone just to view the dashboard.

**v3.19.4:** edit dashboard panels and table columns, compare selected-period usage and hourly burn-rate gauges, and switch themes or languages. Session controls and message inboxes remain available. See [release notes](docs/release-notes_v3.19.4.md).

## What you can see

- Computers, host applications, terminal or conversation locations, AI tools, models, and session identities. Existing AI filters remain alongside app navigation and a model selector.
- Rolling usage for **24h, 12h, 5h, 1h, 30m, and 10m**. The current rate is an average over up to the latest 60 seconds.
- Usage-share treemaps by session, app, execution tool, or model for the selected time window. Hover or select small areas for exact values.
- Input, cached input, cache writes, and output from reported usage. Unknown values stay unknown; partial collection history is marked.
- Claude Code and Codex account quota reports: 5-hour and weekly windows when reported, reset times, identity, and last update. Only applicable reported windows are shown; an unavailable account report stays unknown, and cached reports are marked.
- Computer CPU/memory and attributable session process resources.
- Codex Goal database state and Claude Code Goal transcript observations. Claude Code `/loop` / scheduled-task invocations and fires where observed.
- Skill files in supported user/project/plugin paths, deduplicated by resolved path. Installed, invoked, tool-returned, and successful workflow are separate claims; enablement and whole-workflow success are not currently verified.
- App focus, supported turn interruption/resumption, and explicit CLI termination. A remote focus request brings the app forward **on that computer**; it does not stream its screen.

Cross-computer totals include fresh reports only. Offline computers retain their last report, clearly marked offline. Usage measures reported tokens, not a provider invoice or subscription balance.

## Connection support

| Source | Current behavior |
| --- | --- |
| Claude Code / compatible GLM sessions | Local usage records when a running session can be matched |
| Codex CLI | Local usage reports and process resources when matched |
| Aside internal sessions | Read-only session index and per-request token reports; active and recent 24-hour sessions, excluding archived/private/ephemeral records. App focus and supported session stop; no shared daemon termination or per-session resource estimate |
| Gemini CLI, OpenCode, Aider, Goose, Qwen, Copilot CLI, Droid, Amp, agy | Recognized entrypoint/process detection; detailed token support varies |
| Cursor, VS Code, Terminal, iTerm, Warp, Zed, Orca and other recognized host apps | Process-parent attribution; opening an IDE alone does not prove an AI task is active |
| Orca-hosted supported sessions | Verified terminal-specific controls where session identity and current input state match |
| Other identified CLIs | App focus when a host app is known, and targeted CLI termination; turn pause/resume disabled without an adapter |

## Architecture

Local default: `browser on this Mac → loopback companion → local reports / processes`. No account is required.

Optional approved managed remote:

```text
macOS companion ── outbound TLS/WebSocket ── Cloudflare Worker
                                                    │
                                             account-specific
                                               Durable Object
                                                    │
Browser / phone ───── Google login + TLS ────────────┘
```

The public web interface is hosted with Sites. Firebase Authentication verifies Google sign-in. D1 stores hashed device credentials, pairing records, and single-use browser connection tickets. A separate Durable Object per Firebase user owns that account's sockets and latest reports.

Commands require a fresh report, an allowed capability, an exact session control key, and the selected account/device. Commands expire, are never queued for offline devices, and are deduplicated before execution. Local PID/start-time checks guard against PID reuse. Termination uses SIGTERM, not a host-IDE or process-group kill.

## Privacy

Monitoring snapshots contain allowlisted device/app/session labels, model names, usage totals, resource measurements, control outcomes, and bounded activity summaries. It excludes raw conversations, full file paths, provider API keys, environment variables, command-line arguments, Goal text, skill paths, raw activity events, and account email addresses. Instructions explicitly sent by the user are relayed to the chosen AI session. The relay retains delivery metadata and a fingerprint, not the instruction body; the receiving tool may retain the instruction in its conversation. Remote quota cards use a hashed account identifier; provider credentials remain local. Names can still reveal information: choose project and device names accordingly.

Local history and a device credential are stored under `~/Library/Application Support/1top`; the credential file uses owner-only permissions. The relay stores a hash of that credential. Latest cloud snapshots and command receipts expire after 24 hours without replacement. Disconnecting a device revokes access and removes its latest snapshot; a revocation record may remain in the authentication database.

## Build and development

Requires macOS, Python 3.11+, Node.js, and Xcode Command Line Tools. These commands are for contributors; the intended desktop onboarding does not require a terminal.

```bash
python3 -m venv .venv
.venv/bin/pip install -e . pyinstaller
.venv/bin/python -m unittest discover -s tests -q
.venv/bin/1top local
```

Build the Apple Silicon desktop app:

```bash
scripts/build-macos.sh
```

The resulting `build/1top_v3.6.0/1top.app` has a **local ad-hoc signature**, not a public distribution signature. Do not present it as notarized or instruct users to disable Gatekeeper. Public downloads are labeled as previews; production signing and notarization remain pending.

Web development:

```bash
cd site
npm ci
npm run dev
```

Relay checks:

```bash
cd cloud
npm ci --legacy-peer-deps
npm test
npm run check
```

For your own deployment, create your own Firebase project with Google authentication, replace the public Firebase configuration and authorized domains, create a D1 database from `cloud/schema.sql`, provision your own `hosted_access` grants and enrollment policy, and configure your own Cloudflare bindings and web origins. The companion relay URL is deliberately pinned in `agent/onetop/bridge.py`; update it when self-hosting. Register your own Sites project instead of reusing this repository's hosting ID.

## Limits and validation

Each approved account has a server-side device allowance (at most 25 registered computers) and 12 simultaneous browser connections per account. Agent reports are sent approximately every three seconds. These are implementation limits, **not a claim of tested production capacity**. The automated tests exercise account boundaries, ticket reuse, stale identities, command deduplication, usage aggregation, payload minimization, and local controls. Large-scale load, diverse customer environments, and public installer acceptance still need validation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for adding tool adapters. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Never attach credentials, real conversation logs, or private screenshots to public issues.

MIT license.


Connection setup and managed billing configuration: [relay guide](cloud/README.md). Release validation and remaining signing gates: [v3.6.0 notes](docs/release-notes_v3.6.0.md).

Remote AI instructions: mobile and web provide a text composer. Input-capable idle terminal sessions accept a new prompt; running Aside sessions queue it after the current step. Unsupported, stale or ambiguous inputs stay disabled. This does not expose a general shell execution endpoint.
