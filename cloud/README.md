# 1top relay

Local desktop monitoring is free and does not need this server. Remote access can use the managed relay or a relay in your own Cloudflare account.

## Your own Cloudflare account

1. Sign in at https://1top.si/settings. Copy your setup command from **Deploy my own relay**.
2. In this repository's `cloud` directory, run `npm ci --legacy-peer-deps`, then `npm run setup -- --owner YOUR_USER_ID`.
3. Complete Cloudflare's own authorization if requested. The script creates a separate D1 database, configures an owner-only relay, and prints its HTTPS address. It does not use the managed service's database or grant access to other Google accounts.
4. Paste that address into the website's Settings. On macOS choose **Remote device connection** in the menu-bar options; on Windows choose **Connect remote server** in the tray menu. Mobile has a **Connection server** field on the sign-in screen. Use the same address on each device.

The generated configuration is in ignored `.selfhost/`. Keep it for upgrades. Re-running the same command reuses its database. Cloudflare usage is billed to the selected Cloudflare account. Free-plan quotas still apply; this is not a promise of unlimited free remote hosting.

CLI alternative: `1top connect --relay https://YOUR-RELAY.workers.dev` when using the Python package installation.

## Managed billing (closed by default)

The managed deployment keeps `BILLING_ENABLED=false` and `PAIRING_ENABLED=false`. Configuring Stripe alone never silently opens enrollment.

Before opening a managed plan:

- Apply `migrations/0003_billing.sql` to the existing D1 database.
- Configure a monthly recurring Stripe Price, a customer portal, and a webhook at `/api/billing/webhook`.
- Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with `wrangler secret put`. Never put them in repository files or the browser.
- Set `STRIPE_PRICE_ID`, `PLAN_MAX_DEVICES`, and `BILLING_ENABLED=true` only after selecting a price and completing Stripe account activation.
- Test Checkout, duplicate submissions, renewal, cancellation, failed payment, refunds/disputes policy, and portal access using Stripe test mode. Open `PAIRING_ENABLED` only after the launch review.

Handled events: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, invoice.payment_action_required. The signed event identifies a persisted customer mapping; current Stripe state is re-read under that account's Durable Object lock. Only an active configured subscription with a paid latest invoice grants access. Cancellation at period end preserves the already-paid period. A past-due or canceled subscription revokes managed access; operator grants remain independent of billing.

## Verification and cost behavior

`npm test` and `npm run check` cover authentication, cross-account isolation, billing signatures, paid-state projection, duplicate checkout, revocation, and explicit self-host ownership. `ONETOP_BENCHMARK=1 npm test -- --run test/load.test.ts -u` runs the optional local 25-account / 50-device load fixture and writes a measurement snapshot. It is not a production capacity or invoice benchmark.

A companion reports every 3 seconds with a connected viewer and every 60 seconds without one. One device retains its latest summary; stale summaries and action receipts expire after 24 hours. Limits include 25 devices, 12 viewers per account, 256 KB messages, and authenticated request admission. Managed public enrollment remains closed until billing and operational limits are approved.
