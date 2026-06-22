# @questili/razorpay-recurring-upi

Storage-neutral SaaS billing core for Razorpay recurring UPI and UPI Autopay flows. This package holds
the domain logic; the actual Razorpay integration lives in
[`@questili/razorpay-recurring-upi-provider`](../razorpay), and production persistence can be wired
through [`@questili/razorpay-recurring-upi-prisma`](../prisma-adapter). Part of the
[Razorpay Recurring UPI Kit](../../README.md).

> **Status: alpha.** API may change before `1.0`.

## Exports

The package has three entrypoints:

| Entrypoint | What it provides |
| ---------- | ---------------- |
| `@questili/razorpay-recurring-upi` | The facade, types, errors, clock/logger/id helpers, and pure domain functions. |
| `@questili/razorpay-recurring-upi/storage/in-memory` | `InMemoryBillingStorage` (re-exported from the main entry too). |
| `@questili/razorpay-recurring-upi/testing` | `createTestBilling`, `FakeProvider`, `FixedClock`, `sequentialIdFactory`, `defaultTestConfig`. |

## Public API

Create a billing instance with `createRazorpayRecurringUpiBilling`. It returns a `Billing` object whose
namespaces are the entire API surface:

```ts
const billing = createRazorpayRecurringUpiBilling({ config, storage, providers });
```

| Namespace | Responsibility |
| --------- | -------------- |
| `billing.config` | The validated `BillingConfig` (plans, grace period, mandate caps, retry schedule, signed preview-token secret). |
| `billing.plans` | `list()` / `get(id)` over configured plans. |
| `billing.customers` | Create and look up customers. |
| `billing.mandates` | Create a mandate authorization, verify the checkout callback, cancel, and inspect mandate health. |
| `billing.subscriptions` | Create, cancel, and inspect subscriptions tied to a customer + plan + mandate. |
| `billing.renewals` | `runRenewals(opts)` — charge due subscriptions through the provider and record invoices. |
| `billing.planChanges` | Mid-cycle plan changes with proration. |
| `billing.discounts` | Validate and redeem discount codes against a subscription. |
| `billing.invoices` | Build, record, and list invoices. |
| `billing.entitlement` | Compute feature access (`computeEntitlement`) from subscription state. |
| `billing.webhooks` | Verify provider signatures and normalize webhook payloads into kit events. |
| `billing.scheduler` | A runnable renewal/dunning loop; delegates to `renewals.runRenewals`. |
| `billing.onOperationalEvent(hook)` | Subscribe to operational events (retries, failures, reauthorization). |

Pure domain helpers are also exported for advanced/test use: `computeProration`, `buildInvoice`,
`chargeableAmount`, `validateDiscountCode` / `discountAmount`, `computeEntitlement`, `classifyFailure`
/ `nextRetryAt`, the state machines (`subscriptionMachine`, `mandateMachine`, `invoiceMachine`,
`chargeAttemptMachine`), `mandateHealth` / `canChargeMandate` / `exceedsMandateCap`, renewal scheduling
(`periodFor`, `addInterval`, `remainingFraction`), and money utilities (`roundPaise`, `addSubunits`,
`subtractSubunits`, `allocate`, `formatForDisplay`).

Supporting infrastructure: `BillingError` / `isBillingError`, `systemClock` / `FixedClock`,
`silentLogger` / `consoleLogger`, `randomIdFactory` / `sequentialIdFactory`.

## In-memory storage

`InMemoryBillingStorage` implements the `BillingStorage` interface entirely in memory. Use it for
prototyping, examples, and tests. Pass a shared `Clock` and optional `IdFactory` for deterministic
behavior:

```ts
import { InMemoryBillingStorage, systemClock, sequentialIdFactory } from "@questili/razorpay-recurring-upi";

const storage = new InMemoryBillingStorage({
  clock: systemClock,
  idFactory: sequentialIdFactory(1)
});
```

For production, implement `BillingStorage` against your database — see the Prisma adapter in
[`packages/prisma-adapter`](../prisma-adapter).

## Testing helpers

From `@questili/razorpay-recurring-upi/testing`:

- **`createTestBilling(overrides?)`** — wires a deterministic clock, sequential ids, in-memory storage,
  a default test config, and a `FakeProvider` into a real `Billing` instance. Returns
  `{ clock, storage, provider, billing }`. The fastest way to exercise the full lifecycle with no network.
- **`FakeProvider`** — an in-memory `RecurringPaymentProvider`. Mutate `provider.behavior` between calls
  to drive outcomes: `nextPaymentState` (`captured` | `pending` | `failed`), `asyncCapture`
  (pending → captured on next status poll, modeling UPI's async debit), `verifyStatus`, `instrumentLabel`.
- **`FixedClock`** — a clock you advance manually so time-based logic (renewals, grace periods, retries)
  is deterministic.
- **`sequentialIdFactory`** / **`defaultTestConfig`** — predictable ids and a ready-made plan set.

## Runnable snippet

```ts
import { createTestBilling } from "@questili/razorpay-recurring-upi/testing";

const { clock, billing } = createTestBilling();

// Ensure a billing customer (idempotent by external id).
const customer = await billing.customers.ensure({
  id: "user_123",
  email: "rupa@example.com",
  name: "Rupa",
  contact: null
});

// Start a UPI mandate authorization. FakeProvider returns a checkout-shaped result.
const authorization = await billing.mandates.createAuthorization({
  customer: { id: "user_123", email: "rupa@example.com", name: "Rupa", contact: null },
  method: "upi",
  amount: 100, // paise
  currency: "INR",
  mandate: { maxAmount: 1_000_000, frequency: "monthly", expiresAt: null }
});

// Verify the (faked) checkout callback. FakeProvider confirms the token by default.
const verified = await billing.mandates.verifyAuthorizationCallback({
  provider: "razorpay",
  authorizationId: authorization.authorizationId,
  response: {
    razorpay_payment_id: "pay_fake_1",
    razorpay_order_id: authorization.providerOrderId,
    razorpay_signature: "ignored-by-fake"
  }
});
console.log(verified.status); // "confirmed"
```

To drive renewals, advance the `FixedClock` past the next renewal boundary and call
`billing.renewals.runRenewals()` (defaults to `clock.now()`); each due subscription is charged through
the registered provider and recorded as an invoice, with failures routed into the retry/grace-period
state machine.

## License

Apache License 2.0. See [LICENSE](../../LICENSE). Copyright 2026 Questili.
