# OmniRoute port attribution

Upstream: https://github.com/cheaper-inference/OmniRoute

Pinned revision: `b2a64106c9e47d654012d24d5ae5424c950649cc`.

Copyright (c) 2026 diegosouzapw. MIT license reproduced verbatim in `LICENSE`
and packaged as `onetop/licenses/omniroute.txt` with the Python/macOS/Windows agent.

Python adaptation in `agent/onetop/routing_policy.py` and its gateway integration:

- [`src/sse/services/auth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b2a64106c9e47d654012d24d5ae5424c950649cc/src/sse/services/auth.ts): account eligibility, fill-first selection, session affinity and failed-account exclusion.
- [`src/sse/services/quotaLimitPolicy.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b2a64106c9e47d654012d24d5ae5424c950649cc/src/sse/services/quotaLimitPolicy.ts): applicable quota windows, threshold and reset gating.
- [`src/sse/services/chatQuotaExhaustion.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b2a64106c9e47d654012d24d5ae5424c950649cc/src/sse/services/chatQuotaExhaustion.ts): quota exhaustion distinguished from short rate limits.
- [`src/sse/handlers/chat.ts`](https://github.com/cheaper-inference/OmniRoute/blob/b2a64106c9e47d654012d24d5ae5424c950649cc/src/sse/handlers/chat.ts): unavailable account marking and bounded same-provider retry.

1top changes: SQLite cooldown persistence, fixed upstream hosts, local bearer-key
authorization, existing native credential stores, original client session identity,
stream-boundary retry control, and collector attribution to the actual account.
TypeScript dependencies and OmniRoute's web UI are not embedded.

Credential refresh uses 1top's existing managed-profile lock, identity verification,
and compare-before-write behavior. Its concurrent-refresh checks were compared to
upstream `open-sse/services/tokenRefresh/casGuard.ts` and `rotationMap.ts`; 1top keeps
refresh tokens in their original native stores. Codex refresh remains native
`account/read {refreshToken:true}`. No upstream identity-cloaking code is included.

Protocol references: upstream `open-sse/executors/base.ts`, `executors/codex.ts`,
and `config/glmProvider.ts`. Only native request forwarding is implemented; this
port does not include the upstream cross-protocol message translator.
