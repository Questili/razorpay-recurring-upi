# Razorpay Recurring UPI Kit

Open-source SaaS billing kit for **Razorpay recurring UPI and UPI Autopay**. It keeps subscription,
invoice, dunning, and entitlement logic in your app while using [Razorpay Recurring Payments](https://razorpay.com/docs/payments/recurring-payments/)
for mandate authorization and token charges across UPI, cards, and e-mandates. Includes a Prisma
storage adapter and a Next.js example app.

> **Status: alpha.** The API is functional but may change before `1.0`. Not production-hardened yet.

## What it does

- **Mandate-based recurring charging** over UPI Autopay, card recurring tokens, and e-mandates.
- **App-owned subscriptions**: create, renew, change plans mid-cycle, cancel, with proration.
- **Invoices, discounts, and dunning**: deterministic invoice building, discount redemption, and a
  retry/grace-period state machine for failed charges.
- **Entitlement gating**: compute feature access from subscription state.
- **Webhooks**: signature verification + normalized events for the host app to react to.
- **Scheduler**: a runnable renewal/dunning loop you drive from your own job runner (cron, queue, etc.).
- **Storage-neutral**: bring your own persistence via the `BillingStorage` interface. In-memory adapter
  included; Prisma adapter in `packages/prisma-adapter`.
- **Provider contract**: the Razorpay provider is the first implementation. The core has no
  provider code in it.

## What it does NOT do

- **No Stripe.** Stripe is out of scope for this kit.
- **No raw credential storage.** The kit never persists `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`, or `BILLING_PREVIEW_TOKEN_SECRET`. You supply them from your secret
  manager at runtime.
- **No tax, GST, accounting, or legal advice.** Tax and compliance are the merchant's responsibility.
- **No merchant compliance guarantee.** You must complete your own Razorpay recurring compliance review.

## Monorepo layout

This is a pnpm workspace. Each package is independently published under the `@questili/` scope.

| Package | Path | Description |
| ------- | ---- | ----------- |
| [`@questili/razorpay-recurring-upi`](./packages/core) | `packages/core` | Storage-neutral domain core + in-memory storage + testing helpers. |
| [`@questili/razorpay-recurring-upi-provider`](./packages/razorpay) | `packages/razorpay` | Razorpay Recurring Payments provider. |
| [`@questili/razorpay-recurring-upi-prisma`](./packages/prisma-adapter) | `packages/prisma-adapter` | Prisma storage adapter for `BillingStorage`. |
| [`razorpay-recurring-upi-example`](./packages/nextjs-example) | `packages/nextjs-example` | Next.js reference app (core + Razorpay + Prisma). |

## Quick start

Requirements: Node `>=20`, pnpm.

```bash
pnpm install
pnpm build      # builds core + razorpay (and prisma-adapter)
pnpm test       # vitest
pnpm typecheck  # tsc --noEmit across packages
```

## Minimal usage

Wire the core facade with in-memory storage and the Razorpay provider. Amounts are integer **paise**.

```ts
import {
  createRazorpayRecurringUpiBilling,
  InMemoryBillingStorage,
  systemClock
} from "@questili/razorpay-recurring-upi";
import { razorpayProvider } from "@questili/razorpay-recurring-upi-provider";

const billing = createRazorpayRecurringUpiBilling({
  config: {
    plans: [
      { id: "starter_monthly_inr", name: "Starter", interval: "monthly", amount: 50000, currency: "INR", features: ["core"] }
    ],
    gracePeriodDays: 7,
    defaultMandateMaxAmount: 1_000_000,
    supportedMethods: ["upi", "card", "emandate"],
    retryScheduleMs: [60_000, 300_000, 3_600_000],
    defaultAuthorizationAmount: 100,
    previewTokenSecret: process.env.BILLING_PREVIEW_TOKEN_SECRET!
  },
  storage: new InMemoryBillingStorage({ clock: systemClock }),
  providers: {
    razorpay: razorpayProvider({
      keyId: process.env.RAZORPAY_KEY_ID!,
      keySecret: process.env.RAZORPAY_KEY_SECRET!,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET!
    })
  }
});

// Ensure a customer exists, then start a UPI Autopay mandate authorization.
const customer = await billing.customers.ensure({
  id: "user_123", // your app's external id
  email: "rupa@example.com",
  name: "Rupa",
  contact: null
});
const authorization = await billing.mandates.createAuthorization({
  customer: { id: "user_123", email: "rupa@example.com", name: "Rupa", contact: null },
  method: "upi",
  amount: 100, // INR 1.00 authorization hold, in paise
  currency: "INR",
  mandate: { maxAmount: 1_000_000, frequency: "monthly", expiresAt: null }
});
// `authorization.checkout` carries the values your frontend Razorpay checkout needs.
```

Recurring Checkout should be opened for the selected rail only. UPI test-mode
flows are supported by Razorpay, but recurring Card AutoPay requires a live
Razorpay account with card recurring enabled; the adapter rejects card
authorization when used with `rzp_test_...` keys.

See [`packages/core/README.md`](./packages/core/README.md) for the full API surface and
[`packages/razorpay/README.md`](./packages/razorpay/README.md) for the adapter, env vars, and the
webhook route snippet.

## Documentation

- Design and planning docs (still present, written before implementation):
  - [`SPEC.md`](./SPEC.md) — product and technical specification.
  - [`SCEP.md`](./SCEP.md) — scope, constraints, and execution plan.
  - [`docs/API-SKETCH.md`](./docs/API-SKETCH.md) — proposed public TypeScript API.
  - [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) — domain model and Prisma mapping notes.
  - [`docs/RESEARCH.md`](./docs/RESEARCH.md) — Razorpay and OSS research with source links.
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- Security reporting: [`SECURITY.md`](./SECURITY.md).

> Note: the planning docs describe the original design intent. Where they disagree with the implemented
> code in `packages/*/src/index.ts`, **the code is authoritative.**

## Status

Alpha. The core domain, Razorpay adapter, Prisma adapter, and Next.js reference example are implemented
and tested. Expect breaking changes before `1.0`.

## License

[Apache License 2.0](./LICENSE). Copyright 2026 Questili.
