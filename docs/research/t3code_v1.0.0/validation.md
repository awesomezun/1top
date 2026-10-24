# Validation and adoption gates — v1.0.0

## Executed

The [probe](../../../scripts/research/probe-t3-launcher.py) ran the exact pinned T3 npm launcher with a temporary home, a local HTTP fixture, and an inert shell executable. It did not download or execute T3's application, authenticate to a service, inspect a conversation, or control a real agent.

| Case | Observed result |
| --- | --- |
| Cold install | Fetches checksum and archive; verified executable runs |
| Warm launch | Reuses completed cache without a download |
| Corrupt archive | Rejects the checksum mismatch; fixture does not execute |
| Unlisted archive | Rejects before downloading or executing an archive |
| Incomplete installation | Replaces incomplete contents with the verified staged install |

All five passed on macOS ARM64 with Node v22.22.3. Exact source hash and results are in [launcher-probe.json](launcher-probe.json). This is functional evidence for those five cases only. Concurrent installation, malicious archive extraction, signed release verification, actual login, desktop installation, and native mobile behavior were not exercised.

To reproduce without overwriting an existing result:

```sh
git clone --filter=blob:none https://github.com/pingdotgg/t3code.git /tmp/t3code-reference
git -C /tmp/t3code-reference checkout 27e0c684c585f955252d65f06206dd11a143bff5
python3 scripts/research/probe-t3-launcher.py \
  --reference /tmp/t3code-reference \
  --output /tmp/1top-t3-launcher-results.json
```

Use a new temporary destination if one already exists. The probe refuses to overwrite results. Running it on other supported POSIX platforms is a new observation, not covered by this checkpoint's result.

## Required before adopting a launcher

1. Use a verified 1top-owned npm name and release repository; keep the package unpublished until the matching artifact and checksum exist.
2. Package the actual collector so an end user does not need a Python installation. Derive the package and archive versions from one release version.
3. Test cold/warm installs, missing assets, checksum mismatches, interrupted downloads, stale cache markers, simultaneous launchers, unsupported architectures, and disk-full failures. No test may execute a real AI provider.
4. Test extraction boundaries and publisher verification. A checksum fetched from the same compromised source as an archive is not an independent trust anchor.
5. Confirm that launching while the desktop companion is already running produces a useful connection result and does not start a second collector or falsely claim pairing succeeded.
6. Verify forwarded exit status and signals using a disposable fixture. Stopping the monitor must not terminate the observed AI sessions.
7. Keep Developer ID/notarization gates for public macOS artifacts. Test first launch on a clean supported machine, including quarantine behavior.
8. Publish artifacts, then the npm package, then enable installation instructions and downloads. Include MIT notices for copied code and audit the actual package contents for private data.

## Required before changing cloud transport or cadence

| Scenario | Measurements / acceptance evidence |
| --- | --- |
| 1, 5, and 25 devices per account | Device-to-view p50/p95 freshness, CPU/RAM overhead, payload sizes, hub writes, fan-out messages, disconnect recovery |
| 100 sessions per device | Serialization/validation cost, bounded payloads, rendering responsiveness, total accuracy |
| No viewers vs 1 and 12 viewers | Verify any sampling changes do not stop usage recording; measure idle cost separately |
| Flapping and simultaneous reconnect | Bounded retries with jitter; no reset-to-one-second storm; one connection owner |
| Offline, sleep, and clock skew | Clearly stale summaries, expired controls rejected, recovery never implies unobserved work was counted |
| Duplicate/copied histories | Count each source record once across hosts; partial records do not inflate totals |
| Shared account and revoked device | Account isolation, revocation, retained-data policy, no unauthorized control path |
| Uncertain control delivery | Explicit unconfirmed outcome; no automatic retry or offline execution |

These are test scenarios, not passed results. Use synthetic devices and fake control executors for load and failure tests. No comparative throughput, latency, operating cost, battery, or scalability claim is established by this source review.

## Required before native iOS release

- A shared, versioned protocol with per-feature capability negotiation and a tested account/device isolation boundary.
- Secure token storage, browser-based sign-in return handling, logout and account-switch cleanup, and defined account deletion behavior.
- Foreground/background transitions, expired credentials, killed sockets, stale cached reports, and explicit control results.
- Platform push for alerts, permission-denied states, and device-token revocation; widget data must expire visibly.
- Authentication and feature design reviewed against the current App Store rules; do not assume a Google-only sign-in flow or a thin web wrapper will satisfy review.
- Signed TestFlight build and real-device validation before describing a native iOS app as available. No such 1top build is included in this checkpoint.

## Source-evidence checks

The source manifest records file hashes and relevant ranges rather than copying upstream source. Documentation describes intended behavior; code inspection and fixture tests provide narrower, distinct evidence. Release artifacts and the App Store listing establish availability, not the runtime quality of those products. The mobile README/release discrepancy is retained in the report rather than silently choosing the convenient statement.
