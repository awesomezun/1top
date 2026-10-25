# 1top

**Your AI agents, across apps and computers.**

[Website](https://1top.si) · [Try the demo](https://1top.si/app?demo=1) · [한국어](README.ko.md)

<!-- gitreels:start -->
<p align="center">
  <a href="https://gitreels.com/awesomezun/1top"><img src="https://gitreels.com/awesomezun/1top.webp" alt="awesomezun/1top in 15 seconds" width="100%"></a>
  <br>
  <a href="https://gitreels.com"><img src="https://gitreels.com/badge.svg" alt="Made with GitReels" height="24"></a>
</p>
<!-- gitreels:end -->

See which computer, application, and terminal owns a session; inspect reported token usage and CPU/RAM; send supported controls to the selected session.

**Status: early preview.** The browser demo is available without installation. Download the macOS Apple Silicon DMG, Windows x64 installer, or Android APK from the [download page](https://1top.si/#download). The Mac app is locally signed but not notarized; the Windows installer is unsigned. Android is distributed as a signed preview APK. iOS store distribution and clean-machine installer acceptance remain pending. Broad process detection does not imply every tool exposes tokens or supports pause/resume.

## Using 1top

The default flow is **open 1top → desktop dashboard**. Click the menu-bar icon for a compact summary or account limits; use **Open full dashboard** for the standalone desktop window. Local monitoring is free and requires no login or cloud relay. Keep 1top running in the menu bar. Optional **Open at login** starts it after you sign in to macOS.

Remote access is optional. Managed access currently requires a server-issued grant; public device enrollment and public paid signup are closed. Google sign-in alone does not create remote access. A previously linked operator device keeps its existing connection. Customer-owned cloud setup is planned; there is no automated provisioning flow yet. See [service policy](docs/service-policy_v1.0.0.md).

A browser login cannot inspect or control arbitrary local processes. The companion provides that local connection. Nothing is installed on a phone just to view the dashboard.

**v3.4.1:** usage-share maps now fill the dashboard width. The context-map view has been removed from desktop, web, and mobile. Session, AI, app, model, and control views remain available. See [release notes](docs/release-notes_v3.4.1.md).

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

The cloud payload contains allowlisted device/app/session labels, model names, usage totals, resource measurements, control outcomes, and bounded activity summaries. It excludes raw conversations, full file paths, provider API keys, environment variables, command-line arguments, Goal text, skill paths, raw activity events, and account email addresses. Remote quota cards use a hashed account identifier; provider credentials remain local. Names can still reveal information: choose project and device names accordingly.

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

The resulting `build/1top_v3.4.1/1top.app` has a **local ad-hoc signature**, not a public distribution signature. Do not present it as notarized or instruct users to disable Gatekeeper. Public downloads are labeled as previews; production signing and notarization remain pending.

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


Connection setup and managed billing configuration: [relay guide](cloud/README.md). Release validation and remaining signing gates: [v3.4.1 notes](docs/release-notes_v3.4.1.md).
