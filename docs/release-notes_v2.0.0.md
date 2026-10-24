# 1top v2.0.0

Free local monitoring now starts without Google sign-in. Explicit remote connection and a previously saved connection remain opt-in. Remote pairing failure leaves the local dashboard available. The menu-bar app opens the local dashboard by default.

The local and public web workspaces use a new dark information hierarchy. The local UI adds a nonmodal session inspector and an Activity view. Sessions retain all six usage windows, resources, identity checks, and supported control confirmations. Public demo controls never execute real commands.

## Operational evidence

- Codex: read-only `goals_1.sqlite`, including stored status, objective, usage and optional token budget. An active stored Goal is distinct from a connected running session.
- Claude Code: `goal_status` transcript attachments distinguish active, achieved, cleared and failed observations. Missing usage/duration stays unknown. This is the last observed record, not a live Goal control API.
- Claude Code `/loop`: observed scheduling calls and `scheduled_task_fire` records. Current queue state, next actual fire and entire workflow success remain unverified. GLM-backed Claude Code uses this same runtime; Codex is not shown as supporting `/loop`.
- Skills: supported user/project roots and Claude plugin installation registry, deduplicated by resolved file. Claude Code `Skill` invocations and tool-return/error evidence are distinct from successful task completion. Codex skill execution tracking and universal plugin enablement detection are not implemented.
- Scanning is incremental and starts with a bounded recent log tail. This is partial history. It cannot establish that a feature was never used.

Only bounded status/usage/count summaries are exported remotely. Goal text, skill paths and raw events stay local. The relay sanitizes the new fields again. Admin / Pro derives from a server-issued operator grant, not a front-end account-name check or an invented payment record. New public managed enrollment remains closed.

## Validation

62 Python tests and 22 relay tests pass; relay TypeScript checks and the production web build pass. Public homepage, app and privacy routes return HTTP 200 with the v2 assets. The updated local companion reports v2.0.0 and retains the existing remote connection. The relay reports v1.2.0 with public pairing disabled.

Automated coverage adds fresh local startup, explicit remote failure fallback, existing opt-in, read-only Goal reads, Claude Goal transitions, native loop fire records, skill alias deduplication, partial log lines, prompt false-positive rejection and activity payload minimization. Relay coverage verifies the server-derived administrator entitlement and rejects extra activity fields.

Orca browser checks use real local data and synthetic hosted demo data: search and reset, all six periods present, period selection, nonmodal detail open/close, real control-dialog cancel only, demo confirmation without command dispatch, and contained horizontal tables. Dark desktop and narrow responsive layouts were visually inspected. No real AI session was interrupted or terminated during UI validation.

Known release limits: local ad-hoc macOS build only; no notarized public installer, published npm launcher or native iOS client. No production-scale load claim, public paid checkout, or automatic customer-owned cloud provisioner. Aside internal-session usage remains unsupported. Mobile-browser layout validation is not native iOS validation.

Previous UI and companion sources were preserved under ignored local release checkpoints. Previous public README text is retained in `docs/archive/`. The macOS build now writes a versioned output directory and refuses to overwrite an existing versioned app.
