# Local OpenTelemetry intake — v1.0.0

Product version: 1top v3.27.0. Backend-only change; desktop, web and mobile presentation files are unchanged.

## Data flow and accounting contract

Claude Code and Codex can export OTLP/HTTP to the existing loopback 1top service.
`/v1/logs`, `/v1/metrics`, and `/v1/traces` accept JSON and protobuf, including bounded gzip requests.
Every request requires the private `X-1top-Telemetry-Key` header. Browser-origin requests are rejected.
No public listening address, new cloud service, or external monitoring subscription is introduced.

JSONL remains authoritative for existing dashboard token totals, rolling windows, and burn rates.
Completed-request OTel logs form a **separate comparison ledger** in `telemetry.sqlite`.
Metric counters and trace token fields are not added to those request totals.
Replayed exports are deduplicated, including across application restarts.
OTel values are never added to `monitor.sqlite.events`; enabling both sources therefore cannot double the displayed spend.
This release does not silently replace missing JSONL with OTel totals: exporters may have different request coverage and timing.

The intake retains only allowlisted measurements and identifiers. Prompt text, assistant text, tool arguments/results,
raw error messages, email, credentials, and raw payloads are not persisted.
Provider account identities are hashed using the existing account-key scheme.
Records are bounded to eight days and 100,000 normalized records. The status response summarizes the latest 24 hours,
up to 250 sessions; its token totals describe that observed interval, not session lifetime.

## Enrichment

Only exact provider + session ID matches attach telemetry to an existing session.
Fresh, unambiguous provider account identity can supersede a configuration-directory hint when it matches an already
observed account. Binding starts at the telemetry observation; earlier usage is not reassigned.
An explicit unknown or conflicting identity suppresses a potentially incorrect profile hint.
Aside identities, billing-provider guesses, terminal controls and session hierarchy are not inferred from model names.

Model/effort enrichment respects observation timestamps. A subagent report cannot relabel its parent.
Periodic metric timestamps cannot establish the current model because those metrics may describe an older model.
Unsupported or missing measurements remain unknown.

## Local API

- `GET /api/telemetry`: transport, mode, receive/store/duplicate/ignore counters, last receipt, retained session summaries.
- `/api/state.telemetry`: receiver summary without the session list.
- `/api/state.sessions[].telemetry`: matching session's observed request count, token vector, account keys,
  latest model/effort, duration, time to first token, error count and available lineage fields.
- Token-vector order: fresh input, cache read, cache write, output. Codex input excludes cached input after normalization;
  reasoning output is not added a second time.
- `usage_authority: "jsonl"`, `mode: "supplement"`, `remote_export: false` explicitly describe this rollout.

`bridge.export_snapshot()` still exports its existing allowlist. Neither detailed OTel events nor the new telemetry
summary is sent to the remote relay. This addition does not claim a reduction in remote hosting cost.

## Enrollment and recovery

Use the bundled agent executable, or the Python package's `1top` entry point:

```text
1top telemetry-enable
1top telemetry-status
1top telemetry-disable
```

The optional `--port` selects the existing local 1top port; default 18766.
Enrollment adds Claude settings and a managed Codex TOML block to discovered profiles.
Existing OTel configurations are preserved rather than replacing another collector destination.
Original files are backed up in the private data directory before modification.
Disabling removes only unchanged 1top-owned configuration; unrelated and subsequent user changes are preserved.
The receiver key and enrollment manifest remain local, with owner-only file permissions.

Start a **new CLI session** to load exporter configuration. Enrollment never stops, resumes, or restarts active AI work.
Claude logs export every second and metrics every ten seconds. Codex uses its exporter defaults.
Beta tracing is not enabled by enrollment, although the receiver supports trace requests.
gRPC is not implemented; use the configured HTTP endpoint.

## Verification

`tests/test_telemetry.py` covers transport authentication, gzip/protobuf/JSON, persistence and retry deduplication,
token semantics, identity conflicts, metadata freshness, content exclusion and reversible configuration.
`tests/otel_cli_smoke.py` launches the actual installed Claude or Codex CLI with isolated temporary configuration
against a local fake model API. This verifies actual exporter formats and delivery without paid model calls,
production credentials, or adding test tokens to the real monitor.

Those tests do not establish performance or account attribution across every CLI version or provider deployment.
The standard receiver requires an instrumented producer; adding it does not automatically instrument Aside or other apps.
Windows packaging includes the dependency metadata, but this change requires a Windows build/device check separately.

## Dependencies and references

`opentelemetry-proto` provides official protocol definitions; its Apache 2.0 license and protobuf's distribution license
are included through package metadata in desktop builds. No full Collector daemon is bundled.

- [Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage)
- [Codex telemetry configuration](https://developers.openai.com/codex/config-advanced/#observability-and-telemetry)
- [OTLP protocol](https://opentelemetry.io/docs/specs/otlp/)
