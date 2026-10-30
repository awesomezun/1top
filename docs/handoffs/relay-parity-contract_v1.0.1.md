# Relay dashboard parity contract v1.0.1

Version: companion 4.3.0 / relay 1.11.0. Prepared on 2026-10-29. This document describes source implementation, not a production deployment.

## Snapshot additions

The existing browser WebSocket `state` and `snapshot` envelopes remain unchanged. Added fields are optional for older companions.

- `features`: `history`, `account_alias` when the companion supports these requests.
- `sessions[]`: `effort`, `effort_source`, `effort_updated`, `last_usage`, `request_input`, `context_size`, `terminal_note`, `pids`, and `usage.{last_minute,last_five_minutes,output_rate,history}`. History entries are `[Unix seconds, total tokens]`, at most 60.
- `sessions[].title`: empty when only a prompt-derived conversation title is available. Do not substitute the computer name or `project · kind` for a conversation title. `terminal` retains the explicit terminal title.
- `calibration.{seconds,used_pp,tokens}` extends the existing `pp_per_token` evidence, both inside session `weekly_estimate` and at `account_quotas[].calibration`.
- `host`: `network.{rx,tx,interfaces}`, `disk.{total,free,percent,read,write}`, `swap.{used,total}`, `load`, `uptime`, `battery.{percent,plugged}`, `process_count`, `unreadable_processes`, `platform`, `os`. Rates are bytes/second; memory and disk values are bytes. Missing measurements remain null.
- `system`: `history` (300 numeric samples), `top` (15 processes), `shared` (30 groups), `monitor`, `sampler_ms`. Command arguments and paths are excluded.
- Root: `collection_ms`, `actions` (last 20 outcome summaries, no input bodies), `resume_prompt`, `quotas`, `orca_terminals`, `process_counts`.

### All 19 slider positions

The same keys are accepted in session `windows`/`weekly_estimate`, account `weekly`, root `periods`/`flow`/`speed_periods`:

`10m`, `30m`, `1h`, `5h`, `12h`, `24h`, `custom:900`, `custom:7200`, `custom:10800`, `custom:21600`, `custom:172800`, `custom:259200`, `custom:604800`, `custom:1209600`, `custom:2592000`, `custom:7776000`, `custom:15552000`, `custom:31536000`, `all`.

Each flow supplies `start`, `end`, `step`, `as_of`, `reported`, `bins`. The six native ranges retain their existing minute-aligned format. Extended ranges use the snapshot clock as their end and at most 240 buckets. Use the supplied bounds; do not assume one-minute buckets or a 24-hour history limit. Period totals and extended flow totals reconcile exactly. Session attribution uses the local range API rules: an account switch never relabels the earlier account's token history. Partial coverage remains marked.

Aggregation runs in a read-only SQLite transaction on the outbound thread. The live collector is not changed by remote range selection. A 50-session local snapshot measured 273ms and 370,130 JSON bytes before final integration; this is one local measurement, not a network benchmark. Large sanitized snapshots are chunked atomically below the Durable Object per-value limit. Incoming WebSocket messages are capped at 4MiB. A populated 250-session fixture measures 3,121,284 bytes; chunks contain at most 35,000 UTF-16 code units, keeping each stored value below 128KiB.

## On-demand history

The authenticated browser WebSocket accepts:

```json
{"type":"history_request","request_id":"UUID","device_id":"UUID","period":"custom:604800","step":"3600","kind":"Claude"}
```

`kind` is optional; supported period keys are listed above. Steps are `60`, `300`, `900`, `3600`, `day`, `week`. The companion enforces the existing maximum 400 series bins.

Reply:

```json
{"type":"history","request_id":"same UUID","device_id":"same UUID","data":{"as_of":0,"coverage":[],"series":{},"heatmap":{}}}
```

Failure replaces `data` with `error`. The data shape follows `usage-history-contract_v1.0.0.md`. Project keys are `project:<SHA-256 of local key>`, `unknown`, or `__other__`; filesystem paths are never transmitted. Labels remain project display names. Time boundaries follow the computer's local timezone. Keep computers separate when their boundaries differ; do not align them by array index.

The web adapter exposes this as its intercepted `GET /api/history`. The relay forwards only within the authenticated owner's account, only to a fresh connected device advertising `history`, and only back to the requesting socket. History does not require terminal-control permission. One pending history request per viewer, a two-second request interval, and a 15-second expiry apply. Responses are not persisted. Mailbox requests have a separate pending slot and limit.

## Renaming

Existing `POST /api/action` accepts `action:rename`, plus `request_id`, `device_id`, `session_id`, `control_key`, `title`. Title must be nonempty, at most 80 characters, and contain no control characters. The current snapshot must advertise session capability `rename`. Owner access, control permission, fresh session identity, expiry, and durable deduplication are required. Results use the existing asynchronous receipt/result format.

`POST /api/accounts/alias` accepts `request_id`, `device_id`, `account_id`, `alias`. Alias is at most 24 characters; empty clears it. The device must advertise `account_alias`, contain that account, and allow control. Response/result semantics and request-ID conflict rules match `/api/action`. The companion rechecks the account against its current snapshot before saving it. This edits a display name only. Provider login and macOS authorization remain local.

## Deferred privacy choices

Request #7: keep Goal objectives, budgets, skill paths, raw events, and schedules local. A future explicit per-device opt-in could export sanitized labels and budgets; no new fields are sent now.

Request #15: keep provider account labels masked (`kind · last six identity characters`) and allow user-selected aliases. Do not send email addresses by default.

## Release boundary

Build and branch CI are authorized. Updating main's release manifest, public 1top.si, Stores, and production relay requires the user's final release approval. Paid Apple distribution signing/notarization is unavailable with the current Personal Team; development signing does not remove that limitation.
