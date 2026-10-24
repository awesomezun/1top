# T3 Code study for 1top — v1.0.0

Reviewed on 2026-10-24. This is a source comparison and a narrowly scoped launcher experiment, not a comparative performance benchmark or a claim that the proposed features have shipped.

- T3 Code revision: [`27e0c684c585f955252d65f06206dd11a143bff5`](https://github.com/pingdotgg/t3code/tree/27e0c684c585f955252d65f06206dd11a143bff5).
- 1top baseline: [`844778346974e3e2d9003958bea5530ff91b6117`](https://github.com/awesomezun/1top/tree/844778346974e3e2d9003958bea5530ff91b6117).
- [Source manifest](source-map.json): pinned links, file hashes, and inspected ranges.
- [Validation and adoption gates](validation.md): what ran, what did not, and what must pass before a release.
- [Launcher fixture results](launcher-probe.json): five passing checks of the upstream launcher using an inert executable and a local HTTP fixture.

## Connection architecture

T3 Connect separates connection authorization from ordinary application traffic:

```text
Connection setup:
client -> T3 relay Worker -> linked environment authorizes a bootstrap

Ordinary application traffic:
web / desktop / mobile <-> Cloudflare Tunnel <-> local T3 server
```

The relay manages identity links, tunnel allocations, and the bootstrap exchange. After bootstrap, ordinary HTTP and WebSocket traffic bypasses that relay Worker. It still traverses the managed Cloudflare Tunnel. This is not evidence of direct peer-to-peer networking, cloud-free operation, or end-to-end encryption against the intermediary. DPoP binds credential use to a client key; that property must not be described as payload encryption. The relay remains a trusted signing authority. Automation webhooks are an explicit exception: the relay forwards them, and optional offline retention can store their bodies for up to 24 hours. [T3 connection design](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/docs/internals/t3-connect.md#L1-L61)

1top currently uses the account hub for both summary delivery and supported controls:

```text
local collector -- outbound WebSocket --> Worker / account Durable Object
                                                |                 ^
                                         validated summary        | selected action
                                                v                 |
                                          web / phone browser
```

The agent sends allowlisted session labels, token statistics, CPU/memory, and supported actions approximately every three seconds. The hub validates, replaces the latest device snapshot, and broadcasts it to the account's browsers. A control request also travels through the hub to the selected device; the device performs its own identity and capability checks. Raw conversations, full paths, provider credentials, environment variables, and command arguments are excluded from this export. The cloud service can process the exported summaries; they are not encrypted end-to-end between the viewing browser and device. [Agent export and transport](https://github.com/awesomezun/1top/blob/844778346974e3e2d9003958bea5530ff91b6117/agent/onetop/bridge.py#L37-L55), [account hub](https://github.com/awesomezun/1top/blob/844778346974e3e2d9003958bea5530ff91b6117/cloud/src/hub.ts#L27-L85)

**Decision: retain the current summary hub while measuring it.** It fits a dashboard that combines several computers and keeps a bounded last-known report. A future terminal stream, large log viewer, or file operation could use a separate device route. That is a proposed hybrid, not an implemented T3 Connect migration. No evidence here establishes which architecture is cheaper or faster under production load.

At an uninterrupted three-second cadence, one device would send 28,800 snapshots per day; 1,000 devices would send 28.8 million. This is arithmetic from the configured cadence, not measured traffic, a bill estimate, or a capacity guarantee. The current hub writes each accepted snapshot. Viewer fan-out, heartbeats, receipts, and other operations must also be measured. Coalescing persistence and adapting detail sampling are candidates; token recording and control freshness must not silently stop when no dashboard is open.

## What is actually stronger today?

1top's clearest differentiation is its focused operational workflow: find an existing session, identify its host application and verified terminal, inspect short rolling usage, and send a narrowly supported action. This is a product-fit judgment, not a usability study or proof of exclusive features.

| Area | Existing 1top behavior | T3 evidence and conclusion |
| --- | --- | --- |
| Existing terminal location | Process ancestry plus verified Orca terminal identity; targeted focus where supported | T3 has its own terminal runtime and external-agent integration. The inspected sources do not establish an equivalent mapping for existing Orca tabs. Preserve 1top's verified mapping. |
| Short operational windows | 10m, 30m, 1h, 5h, 12h, 24h; recent rate averages up to 60 seconds | T3 documents usage-period shortcuts of 24h, 7d, 30d, 90d and separate subscription windows. Preserve 1top's short windows; do not confuse consumption with subscription allowance. |
| External usage history | Detailed current support centers on matched Claude/GLM and Codex records | T3 reads more providers' histories and Cursor account usage. External usage collection is not unique to 1top; this is an area to learn from T3. |
| Resources | Host and attributable session CPU/memory | T3 also implements process telemetry, attribution, and bounded histories. Resource monitoring alone is not an exclusive advantage. |
| Remote authority | Explicit focus, supported interruption/resumption, targeted CLI termination | T3 supports broader workspace and coding operations. Keep 1top's narrower authority unless a new feature explicitly needs more. |
| Data exported to cloud | Allowlisted summaries, not full conversations or workspace files | This describes 1top's present boundary, not a blanket privacy ranking: T3's ordinary application traffic follows a different path. |
| Installation and native mobile | Local macOS build; public signed release and native iOS client are unfinished | T3 has a small npm launcher, desktop release artifacts, and native mobile implementation. T3 is further along in these areas. |

T3 usage and telemetry references: [usage](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/docs/user/usage.md), [resources](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/docs/internals/resource-telemetry.md), [external agents](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/docs/user/outside-agents.md).

### Aside coverage

At the 1top baseline, Aside has no embedded-agent usage adapter and is absent from the named host-app list. Generic `.app` ancestry can still attribute a recognized CLI to a host, but this does not enumerate an app's internal AI conversations. A running browser process, or its contribution to total machine resources, is not evidence that its AI sessions and tokens were counted. The local inspection found no Aside-attributed sessions. A future adapter must establish session identity, authoritative usage records, and supported controls separately. Adding an app name to a list would only improve app discovery. [Discovery implementation](https://github.com/awesomezun/1top/blob/844778346974e3e2d9003958bea5530ff91b6117/agent/onetop/discovery.py#L1-L69)

## Adoption decisions

“Adopt” below means selected for implementation; it does not mean deployed. The only executable upstream experiment in this checkpoint is the launcher fixture probe.

| # | Lesson | 1top decision | Evidence |
| --- | --- | --- | --- |
| 1 | One empty state offers CLI and desktop alternatives | Adopt after both routes point to real releases; keep browser-only viewing clear | `HostedEmptyState.tsx` |
| 2 | A dependency-free npm shim downloads the matching native release | Adopt the small-launcher design; users should not need Python for the packaged CLI | `t3.mjs`, `build-npm-launcher.ts` |
| 3 | Pin runtime to package version; cache immutable versions | Adopt, with platform in cache identity and an explicit completion check | `t3.mjs` |
| 4 | Verify the named archive against SHA256SUMS | Adopt; checksums alone are not publisher authentication | `t3.mjs` |
| 5 | Stage extraction then publish atomically | Adopt; exercise interrupted and concurrent installs before release | `t3.mjs` |
| 6 | Publish binaries/checksums before npm and site availability | Adopt this release ordering; never advertise an unavailable command or download | `release.yml` |
| 7 | Separate stable, preview, and nightly updates | Adopt explicit channels and prevent preview auto-updates into stable installations | `release.yml` |
| 8 | Package the same local server behind multiple entry points | Adapt: CLI and macOS app should use the same 1top collector | `apps/desktop/package.json` |
| 9 | Native desktop updates require signing and release checks | Keep Developer ID, notarization, first-run, and rollback gates | `build-desktop-artifact.ts` |
| 10 | One connection owner per environment | Adopt in a shared client module before adding native mobile | `connection-runtime.md` |
| 11 | Backoff resets after sustained health, with jitter | Adopt; current agent resets on socket open and needs a flap test | `connection-runtime.md` |
| 12 | Network connectivity and data freshness are distinct | Preserve per-device freshness; make expired information visibly read-only | `connection-runtime.md` |
| 13 | Foregrounding must detect sockets killed during suspension | Adopt mobile lifecycle probes and long-background reconnect behavior | `connection-runtime.md` |
| 14 | Reconnection does not automatically replay mutations | Preserve 1top's receipt deduplication and no offline control queue | `connection-runtime.md`, 1top `hub.ts` |
| 15 | Control-plane broker and device data path can be separated | Defer migration; benchmark summary hub first, then consider a hybrid for heavy streams | `t3-connect.md` |
| 16 | Bootstrap credentials are scoped and bound to the client | Evaluate proof-bound credentials for future device routes; never describe DPoP as E2EE | `environment-auth.md` |
| 17 | Read-only and operation permissions are distinct | Adapt to 1top-specific viewing, focus, turn control, and termination permissions | `environment-auth.md` |
| 18 | Managed tunnel allocation has generations and reconciliation | Only adopt if introducing managed tunnels; do not add this operational subsystem by default | `t3-connect.md` |
| 19 | Provider adapters expose capability and health explicitly | Adopt a provider/host capability contract; app presence must not imply token support | `ProviderAdapter.ts`, `providers.md` |
| 20 | Tokens have different categories and dedupe identities | Adopt a normalized record; reasoning already included in output must not be counted twice | `provider-core/.../usage.ts` |
| 21 | Historical parsers resume with guards and tentative-tail handling | Adopt incremental scans with truncate/replace/partial-line tests | `usageScanCache.ts` |
| 22 | Duplicate histories across environments need source fingerprints | Adopt before offering global cumulative usage from copied logs | `usageMerge.ts` |
| 23 | Unknown pricing stays unknown | Preserve unknown token values; do not invent costs or subscription balances | `usageMerge.ts`, `usage.md` |
| 24 | Cursor account totals come from an account API | Evaluate an opt-in adapter; account totals must not be assigned to individual sessions without evidence | `usage.md`, `accountUsage.ts` |
| 25 | Provider history coverage can exceed process detection | Expand adapters by evidence, not marketing list; prioritize actual installed sources | `usage.md` |
| 26 | Subscription limits are separate from historical usage | Add only as a separate view with account identity, reset time, and freshness | `usage.md` |
| 27 | Resource detail collection can depend on subscribers | Adapt expensive detail sampling; keep the token ledger and required liveness running | `resource-telemetry.md` |
| 28 | Process identity includes birth time | Preserve 1top's PID/start-time guard; test process reuse and worker restarts | `resource-telemetry.md` |
| 29 | Histories and event queues need explicit bounds | Adopt count, age, and byte limits; measure large-session behavior | `performance-regressions.md` |
| 30 | Native mobile shares logic but owns lifecycle and secure storage | Use the shared protocol/runtime with a real native client; a responsive site is not an iOS app | `apps/mobile/package.json`, `mobile-development.md` |
| 31 | Background completion alerts use platform push | Adapt APNs/FCM notifications; do not rely on an indefinitely open background socket | `mobile-notifications.md` |
| 32 | Widgets expire stale data and throttle refresh | Adopt explicit timestamp/expiry; never display old usage as live | `subscriptionUsageSnapshot.ts` |
| 33 | Native fingerprints constrain over-the-air updates | Adopt only matching native/JS updates and separate development/release identities | `apps/mobile/README.md` |
| 34 | Background service installation is separate from account linking | Adapt explicit service install/status/uninstall; logging out must have defined local effects | `background-service.md` |
| 35 | Updates stage, trial, commit, and roll back | Adapt collector upgrade safety; never automatically re-submit observed AI work | `server-updates.md` |
| 36 | Capability negotiation tolerates mixed client/server versions | Adopt before independently releasing web, desktop, CLI, and mobile | `overview.md` |
| 37 | Accepted commands and completed effects are different states | Preserve explicit sent/completed/failed/unconfirmed results | `overview.md`, 1top `hub.ts` |
| 38 | Each distributed client carries appropriate license notices | Adopt source attribution and dependency notices for any copied code | `open-source-licenses.md`, `LICENSE` |

## Distribution findings and limits

The inspected release is [v0.1.2](https://github.com/pingdotgg/t3code/releases/tag/v0.1.2). Desktop and standalone CLI platform coverage differ: the launcher supports macOS ARM64, Linux ARM64/x64, and Windows ARM64/x64; the release also has a macOS x64 desktop artifact. Do not infer CLI support from a desktop download. The generated npm package requires Node 20.11 or later; the repository's development toolchain is a separate requirement.

The two reference onboarding images show the same web empty state offering both routes. They do not demonstrate two different desktop runtimes. `npx` is a local command: it downloads/runs a package and starts a local connector. Browser sign-in alone does not gain access to arbitrary computer processes.

T3's [App Store listing](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) was available during this review, while the pinned mobile README still described mobile as not distributed. Treat that README statement as stale; source documentation and release availability need independent checks. The mobile source uses React Native/Expo with native integrations, not a web page merely labeled as an iOS app. Its development client, secure storage, notifications, widgets, and native fingerprint checks are distinct work items. No T3 iOS app was installed or performance-tested in this study.

1top has no published npm package, publicly notarized DMG, or completed native iOS client at this baseline. These are release gaps, not solved by changing onboarding copy. The local macOS app remains an early preview. Public desktop distribution requires the actual Developer ID identity and notarization; npm publication requires a verified package namespace and publishing identity. Native iOS needs its own signing, authentication, lifecycle, push, and release validation.

## Reuse boundaries

The pinned repository is MIT licensed, copyright 2026 T3 Tools Inc. Preserve the complete applicable notice in any copied or substantially adapted source and distributed package. This checkpoint vendors no upstream application code; its probe reads a separately supplied reference checkout and copies a launcher only into a temporary test directory. Do not reuse T3 branding, production account identifiers, signing identities, secrets, or service endpoints. Dependency and asset licenses must be checked separately when selecting code for distribution.

A small launcher, normalized usage records, deduplication, connection lifecycle, and release gates are good adoption candidates. Replacing 1top's Firebase identity system, D1 storage, or summary hub wholesale is not justified by this study. Neither is importing a full coding environment's shell authority into a monitoring dashboard.
