# @questili/razorpay-recurring-upi-provider

Razorpay Recurring Payments provider for
[`@questili/razorpay-recurring-upi`](../core). Implements the kit's
`RecurringPaymentProvider` contract over Razorpay's REST API: customer create/reuse, mandate
authorization (UPI Autopay / card / e-mandate), checkout callback verification, subsequent recurring
charges, token cancellation and status fetch, and webhook signature verification + payload
normalization. Part of the [Razorpay Recurring UPI Kit](../../README.md).

> **Status: alpha.** API may change before `1.0`.

## Install

```bash
pnpm add @questili/razorpay-recurring-upi @questili/razorpay-recurring-upi-provider
```

## Configuration

Create the provider and register it under `providers.razorpay`:

```ts
import { razorpayProvider } from "@questili/razorpay-recurring-upi-provider";

const provider = razorpayProvider({
  keyId: process.env.RAZORPAY_KEY_ID!,
  keySecret: process.env.RAZORPAY_KEY_SECRET!,
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET!,
  merchantName: "Your App" // optional, shown in checkout
});
```

`razorpayProvider` is an alias for `createRazorpayProvider`. Optional fields: `baseUrl` (override the
API endpoint), `methodEndpoint` (map a kit `BillingMethod` to a Razorpay auth payload), `merchantName`.

### Environment variables

All three are **required**. Store them in a secret manager — never in source control.

| Variable | Purpose |
| -------- | ------- |
| `RAZORPAY_KEY_ID` | Key id (`rzp_test_...` or `rzp_live_...`). Surfaced to checkout as `keyId`. |
| `RAZORPAY_KEY_SECRET` | Server-side API secret used for all REST calls and HMAC computation. |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies the `X-Razorpay-Signature` header on incoming webhooks. |

### Test vs live mode

Mode is determined by the key you supply: `rzp_test_*` keys hit Razorpay's test environment,
`rzp_live_*` keys hit live. The adapter calls Razorpay's standard v1 API endpoint for both; override
with `baseUrl` only if you have a specific reason. The kit itself never persists these credentials —
you provide them at runtime.

## How it maps to Razorpay Recurring Payments

| Kit provider method | Razorpay action |
| ------------------- | --------------- |
| `createOrReuseCustomer` | `POST /v1/customers` (or fetch by id when reusing). |
| `createAuthorization` | Create a recurring authorization order (UPI / card / e-mandate). Returns `providerOrderId` + `checkout` values for the frontend Razorpay checkout. |
| `verifyAuthorization` | Verify the checkout callback HMAC, extract the token (`razorpay_payment_id` / `razorpay_order_id` / `razorpay_signature`), and return the mandate token + status + max amount. |
| `createChargeOrder` | Create the charge order for a subsequent debit. |
| `createRecurringPayment` | `POST /v1/payments/create/recurring` — the actual subsequent debit on the saved token. |
| `fetchPaymentStatus` | Poll a payment's status (needed for async UPI capture). |
| `cancelToken` | Cancel the recurring token / mandate. |
| `fetchTokenStatus` | Fetch token/mandate status + remaining cap. |
| `verifyWebhookSignature` | HMAC-SHA256(rawBody, webhookSecret) compared to `X-Razorpay-Signature`. |
| `normalizeWebhook` | Parse and map the webhook payload into kit provider events. |

Provider HTTP errors during a charge are returned as a `failed` result (with failure metadata) rather
than thrown, so the core can classify them through `classifyFailure` and drive dunning.

## Webhook route

Your webhook endpoint must forward the **raw** request body and the `X-Razorpay-Signature` header —
HMAC is computed over the exact bytes, so do not re-serialize JSON.

```ts
// app/api/razorpay/webhook/route.ts (Next.js App Router)
import { NextResponse } from "next/server";
import { billing } from "@/lib/billing"; // your createRazorpayRecurringUpiBilling instance

export async function POST(req: Request) {
  const rawBody = await req.text(); // NOT req.json() — signature is over raw bytes
  const signature = req.headers.get("x-razorpay-signature");
  const providerEventId = req.headers.get("x-razorpay-event-id");

  // process() verifies the signature, normalizes the payload, de-dupes by
  // providerEventId, and reconciles events (e.g. marks a pending UPI debit
  // captured, or fails a charge attempt) in one call.
  const result = await billing.webhooks.process({
    provider: "razorpay",
    rawBody,
    signature,
    providerEventId
  });

  if (result.status === "failed") {
    return new NextResponse("invalid signature or payload", { status: 400 });
  }

  return NextResponse.json({ ok: true, status: result.status, events: result.events });
}
```

### Signature verification notes

- Verification uses a constant-time hex compare of `HMAC-SHA256(rawBody, webhookSecret)` against the
  header. Mismatched secrets, trailing whitespace, or JSON re-serialization will fail verification —
  always pass the untouched raw body.
- Configure your webhook in the Razorpay dashboard and copy the **webhook secret** (distinct from your
  key secret) into `RAZORPAY_WEBHOOK_SECRET`.
- Reject unsigned or unverifiable requests with `400`/`401`. Do not process events from unverified
  payloads.

## Caveats

- **Merchant compliance is your job.** This adapter handles the technical integration only. You must
  complete Razorpay's recurring/mandate onboarding, keep your account in good standing, handle data
  retention, GST/tax, and any consumer-protection obligations. See
  [`../../SECURITY.md`](../../SECURITY.md) and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).
- **UPI subsequent debits are asynchronous.** A successful `/payments/create/recurring` for UPI
  Autopay typically returns `pending`; the actual debit settles later (commonly **24–36 hours**) and is
  confirmed via webhook or a status poll. Design your reconciliation around webhooks + status polling,
  not a synchronous captured response.
- **Recurring Checkout is method-specific.** A normal one-time Checkout can show many methods, but a
  recurring authorization should open the rail the user selected (UPI, card, or bank e-mandate) so the
  resulting token is usable for future debits.
- **Card AutoPay is live-mode only in Razorpay.** The adapter rejects `method: "card"` when the key id
  starts with `rzp_test_`; use UPI/eMandate for test-mode flows and a live recurring-enabled account
  for card AutoPay validation.
- **No raw credential storage.** The adapter never writes keys or the webhook secret to your database.

## Exports

`createRazorpayProvider` / `razorpayProvider`, `createRazorpayProviderWithClient` (inject a client,
used by tests), `RazorpayClient`, `createFetchTransport` / `RazorpayHttpError`, signature helpers
(`computeCheckoutSignature`, `verifyCheckoutSignature`, `verifyWebhookSignature`,
`computeWebhookSignature`), and mappers (`tokenStatusToMandate`, `paymentStatusToState`,
`webhookPayloadToEvents`, `safeLabelForPayment`). The adapter also exports
`isRazorpayTestModeKey` and `assertRecurringMethodAvailableInMode` for host apps
that want to mirror the same method-availability checks in their UI/routes.

## License

Apache License 2.0. See [LICENSE](../../LICENSE). Copyright 2026 Questili.
