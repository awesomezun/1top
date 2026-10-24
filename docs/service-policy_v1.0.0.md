# Service and cost policy — v1.0.0

Status: local capabilities exist; customer-owned cloud onboarding and paid managed service are planned. This document does not announce a checkout, a price, or an available public installer.

## Service boundaries

| Mode | Intended feature boundary | Infrastructure payer | Availability |
| --- | --- | --- | --- |
| Local | Session and app discovery, supported terminal attribution, token history/rate/windows, host/session CPU and memory, supported focus and controls, on-device storage | User's computer; no managed relay required | Local collector/dashboard implemented; public desktop distribution remains gated on signing and notarization |
| Own cloud | Remote access and multiple computers through the user's cloud resources | User's cloud account under its own limits and prices | Automated account connection and provisioning not implemented |
| Managed | Remote access, cross-computer aggregation, and separately specified cloud features | Subscription revenue must cover provisioned infrastructure and operating costs | Restricted preview; payment integration and public pricing not implemented |

Do not charge for a local capability solely because it is useful. Device-side computation and storage can support a substantial free product without an ongoing per-user relay workload. Unsupported providers remain unsupported regardless of the commercial tier; payment does not establish telemetry accuracy or control capability.

The local free scope should include the existing 10m, 30m, 1h, 5h, 12h, and 24h usage windows. Local controls remain capability-dependent: app focus, supported turn interruption/resumption, and explicit CLI termination are different operations. No arbitrary token or session paywall is proposed for local monitoring.

Local export, device-side notifications, and richer local history can also belong to the free tier if implemented. They are eligibility decisions, not claims of current feature availability. Mobile viewing of a local computer, LAN access, and direct peer networking require their own implementation and security validation; they must not be advertised as working simply because they might avoid a managed relay.

The public website, demonstration data, documentation, downloads, and sign-in may remain free. Their hosting/authentication usage can still have limits and costs. Free sign-in must never automatically grant ongoing managed sockets, background polling, cloud history, or push workloads.

## Managed service economics

Managed service must not offer unbounded free infrastructure. Define and enforce, before launch:

- Connected-computer and viewer limits for each plan.
- Connection/activity allowances, update cadence, and retention limits based on measured costs.
- Metered limits for background alerts, historical storage, and exports if those features are introduced.
- A finite trial allowance only after its total cost and stop conditions are enforced.
- Subscription expiry, cancellation, failed-payment grace, and abuse-handling behavior.
- Service-level admission limits and a measured operating budget. Notification of a budget threshold alone is not a hard spending ceiling.

Prices must cover infrastructure, payment processing, support, and margin. No price is fixed here. The source review's three-second snapshot calculation is an illustration of one cost driver, not a total unit-cost measurement. Separate live display frequency from persistence where correctness permits, and preserve control freshness and local usage recording.

Do not automatically turn a free account into paid usage or purchase a cloud plan. Customer-owned cloud deployment must make the chosen account, permissions, and that account's billing responsibility clear. The application should not silently fall back to the operator's managed relay if a customer's cloud becomes unavailable.

## Restricted-preview enforcement

Relay v1.1.0 adds server-side `hosted_access` records. A verified Google identity alone does not create access. Grants have a kind, a device allowance, an optional operator expiry, and mandatory expiry for trial/subscription records. There is no public API that can create a grant, and there is no payment webhook yet.

New public pairing is closed by default with `PAIRING_ENABLED=false`. Start, info, approval, and polling are rejected before D1 work while enrollment is closed. Enabling pairing alone still does not grant a user managed access.

Unapproved, expired, or revoked accounts cannot obtain a browser ticket, redeem a previously issued ticket, open a device socket, list hosted devices, or send controls. Owners retain the ability to revoke their devices without an active grant. Device/browser socket deadlines cannot extend beyond the access expiry known at connection time. The granted device count is enforced again at atomic device insertion, including concurrent claims.

Revoking a grant in D1 blocks subsequent authenticated operations and connection attempts. An already-open device socket retains the deadline assigned when it opened; an immediate-revocation mechanism must close those sockets as part of future billing/admin operations before a public paid launch. This admission gate is not a global dollar cap and does not eliminate ordinary request/abuse costs.

The existing operator's connection is retained through an explicitly provisioned operator grant. Production identities and credentials are not stored in repository configuration or public documentation. Opening customer enrollment requires reviewed provisioning and billing work; do not seed grants for every new Google account.

## Rollout and verification

1. Apply the additive `cloud/migrations/0001_hosted_access.sql` migration before deploying the gated Worker. It does not modify existing device records.
2. Provision only the intended operator account, using an already verified device identity through the administration path. Do not publish that identity or token.
3. Verify the operator grant and existing-device counts, then deploy with public pairing closed.
4. Verify that public pairing returns the closed response and that the existing operator collector still connects and sends fresh reports. Never send a control to a real AI session for this verification.
5. Keep the previous source revision available for investigation, but do not restore the old open-enrollment behavior as a routine rollback.

Automated coverage includes closed enrollment without database access, unapproved Google identities, forged client plan fields, expired/revoked grants, ticket revocation between issuance and redemption, denied device streaming, revocation without a grant, grant-bounded socket expiry, and concurrent device-allowance enforcement. Existing account isolation and targeted-control tests remain required.

Customer-owned cloud OAuth provisioning, the free desktop first-run path, managed checkout/webhooks, usage budgets, automated immediate entitlement revocation, and priced plans remain separate implementation work. Until those gates are satisfied, the public managed service remains restricted.
