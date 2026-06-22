# API Sketch

This is a TypeScript-facing API sketch. Names can change during implementation, but the concepts should stay stable.

## Package entrypoint

```ts
import { createRazorpayRecurringUpiBilling } from "@questili/razorpay-recurring-upi";

const billing = createRazorpayRecurringUpiBilling({
  storage,
  providers: {
    razorpay: razorpayProvider({ keyId, keySecret, webhookSecret }),
  },
  clock,
  logger,
});
```

## Core configuration

```ts
type BillingPlan = {
  id: string;
  name: string;
  interval: "monthly" | "annual";
  amount: number; // subunits
  currency: "INR";
  features?: string[];
  metadata?: Record<string, string>;
};

type BillingConfig = {
  plans: BillingPlan[];
  gracePeriodDays: number;
  defaultMandateMaxAmount: number;
  supportedMethods: Array<"upi" | "card" | "emandate">;
  retryScheduleMs: number[];
  defaultAuthorizationAmount: number;
  previewTokenSecret: string;
};
```

## Customer and mandate authorization

```ts
const setup = await billing.mandates.createAuthorization({
  customer: {
    id: "app_user_123",
    email: "user@example.com",
    name: "User Name",
    contact: "+919999999999",
  },
  method: "upi",
  amount: 100, // authorization amount, usually minimum supported amount
  mandate: {
    maxAmount: 500000, // ₹5,000.00
    frequency: "as_presented",
    expiresAt: new Date("2036-01-01"),
  },
  metadata: {
    source: "pricing_page",
  },
});
```

Returns provider checkout data, not raw secrets:

```ts
type MandateAuthorization = {
  authorizationId: string;
  provider: "razorpay";
  providerOrderId: string;
  providerCustomerId: string;
  checkout: {
    keyId: string;
    orderId: string;
    customerId: string;
    recurring: "1" | "preferred";
  };
};
```

## Checkout completion verification

```ts
await billing.mandates.verifyAuthorizationCallback({
  provider: "razorpay",
  authorizationId,
  response: {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
  },
});
```

This should:

- verify signature
- fetch payment
- extract token id
- store mandate status and safe method metadata
- return a stable mandate id

## Subscription creation

```ts
const subscription = await billing.subscriptions.create({
  customerId: "app_user_123",
  mandateId,
  planId: "pro_monthly_inr",
  startsAt: new Date(),
  trialEndsAt: null,
});
```

## Renewal charge

```ts
const result = await billing.renewals.chargeDueSubscription({
  subscriptionId,
  idempotencyKey: "renewal:sub_123:2026-07",
});
```

The result is one of:

```ts
type ChargeResult =
  | { status: "captured"; invoiceId: string; chargeAttemptId: string }
  | { status: "pending"; invoiceId: string; chargeAttemptId: string }
  | { status: "failed_retryable"; invoiceId: string; chargeAttemptId: string }
  | { status: "reauthorization_required"; reason: string }
  | { status: "skipped"; reason: string };
```

## Upgrade preview and confirmation

```ts
const preview = await billing.planChanges.preview({
  subscriptionId,
  targetPlanId: "team_monthly_inr",
  timing: "immediate",
});

await billing.planChanges.confirm({
  subscriptionId,
  previewId: preview.id,
  idempotencyKey: "upgrade:sub_123:team_monthly_inr:2026-06-21",
});
```

`preview.id` is signed with `config.previewTokenSecret`; confirmation rejects tampered or stale
tokens before it creates an invoice or charge attempt.

If `preview.amountDue > mandate.maxAmount`, confirmation returns `reauthorization_required` instead of charging.

## Cancellation

```ts
await billing.subscriptions.cancel({
  subscriptionId,
  timing: "period_end",
  reason: "user_requested",
});
```

For immediate cancellation:

```ts
await billing.subscriptions.cancel({
  subscriptionId,
  timing: "immediate",
  reason: "user_requested",
  cancelMandate: true,
});
```

## Discount validation

```ts
const discount = await billing.discounts.validateCode({
  code: "LAUNCH50",
  customerId,
  planId,
});
```

Discount effects are applied during invoice creation.

## Webhooks

```ts
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("X-Razorpay-Signature");

  await billing.webhooks.process({
    provider: "razorpay",
    rawBody,
    signature,
    eventId: request.headers.get("x-razorpay-event-id"),
  });

  return new Response("ok");
}
```

Webhook processing must be idempotent and storage-backed.
