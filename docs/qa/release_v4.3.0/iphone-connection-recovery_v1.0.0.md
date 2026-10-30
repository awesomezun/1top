# iPhone connection recovery v1.0.0

Date: 2026-10-30. Companion source: `b03f3c8`. Frontend source and installed app packages were not changed during this recovery.

## Failure and evidence

The installed 4.3.0 companion exported all 19 time ranges, while production still ran relay 1.10.0. That relay closed incoming WebSocket messages longer than 256,000 UTF-16 code units. A read-only reconstruction from the current collector database measured 286,907 code units / 289,915 UTF-8 bytes. A live device-channel probe measured 307,304 code units and received close code **1009, `Message too large`**. The probe sent a snapshot only, never an AI control or message.

Production request logs showed the companion reconnecting approximately every two seconds. Its local status file briefly said `Connected` after each handshake, so that status alone did not establish a healthy connection. The three existing iOS authorization records were unexpired and belonged to an enabled account with an active computer; no credentials were reset.

## Recovery

Deployed the already-integrated relay 1.11.0 from the 4.3.0 source. It accepts messages up to 4 MiB and stores large sanitized snapshots atomically in chunks below the Durable Object per-value limit.

- Worker version: `d4715f2e-b958-4b2f-8687-fa5cac2863a7`.
- First deployment: 2026-10-30 20:52:42 UTC. The public health endpoint reported 1.11.0, but the active Durable Object continued applying the previous limit.
- Activated that same version using `wrangler versions deploy ... --durable-objects-code-update-mode immediate`. Reconnects ceased after approximately 20:54:30 UTC.

Cloudflare documents that an active Durable Object can keep its previous code after a deployment, and supports immediate application for incident recovery: [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/). A health endpoint response alone is therefore insufficient release validation for this connection path.

No homepage, store listing, release manifest, frontend source, or phone/macOS app package was changed. The next app build remains separate from this server recovery.

## Validation

- TypeScript check passed; relay tests: **73 passed, 1 skipped**.
- Actual collector export passed the new relay sanitizer: 45 sessions and 19 periods. Sanitized single-device frame: 257,773 bytes, below the iOS default receive limit.
- The installed iOS source's Swift `LiveMessage` decoder successfully decoded that frame and its 45 sessions. This is a model check, not a screenshot or UI test.
- Frontend freeze v1.19.0: **115/115 unchanged**.
- Opened the already-installed iPhone application `si.onetop.mobile.dev`, version 4.3.0 (7). Production observed that iPhone's `/api/devices` and `/api/live-ticket` requests both return **200** at 20:54:59 UTC.
- Initial post-activation observation: **96 seconds, 0 companion reconnects, 20 successful WebSocket message events, 0 logged exceptions**. The collector switched from idle reporting to repeated live updates after the iPhone connected.
- iPhone screen rendering remains unverified pending user confirmation. The old separate `si.onetop.mobile` 1.5.0 app was preserved; it was not the app opened for this recovery check.

## Local evidence

Ignored directory: `build/qa_v4.3.0/connection-diagnosis/`.

- `probe.json`: production close-code reproduction.
- `relay-deploy.log`, `relay-activate.log`: deployed version and immediate activation.
- `recovery-summary.json`: sanitized request and stability summary.
- `ios-launch.json`: existing physical-device app launch.
- `freeze-check.txt`: frozen file checksums.

Raw snapshots and request logs stay private and are excluded from Git. Future companion releases that expand the wire format must validate the compatible production relay and a sustained device connection before installation is marked complete.
