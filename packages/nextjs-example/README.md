# razorpay-recurring-upi-example

A Next.js 15 (App Router) reference app that demonstrates the **Razorpay recurring UPI billing lifecycle** over the [`@questili/razorpay-recurring-upi`](../../packages/core) kit, using the
[Razorpay provider](../../packages/razorpay) and the [Prisma storage adapter](../../packages/prisma-adapter)
(PostgreSQL).

It shows, end to end:

1. **Mandate authorization** — create the Razorpay recurring checkout.
2. **Checkout verification** — verify the signature server-side and store the
   confirmed mandate.
3. **Subscription + first charge** — create a subscription over the mandate and
   charge the initial invoice immediately.
4. **Webhook reconciliation** — verify + reconcile provider events idempotently.
5. **Entitlement** — read paid / trial / grace access for a customer.
6. **Cancellation** — cancel at period end or immediately (with mandate revoke).
7. **Billing portal** — subscription, plan, renewal date, mandate, invoices.

## Layout

```
src/
  lib/
    prisma.ts          # singleton PrismaClient
    billing.ts         # wires createRazorpayRecurringUpiBilling (Prisma + Razorpay + plans)
  app/
    layout.tsx         # root layout
    page.tsx           # pricing page (server component)
    checkout.tsx       # checkout driver (client component) — full lifecycle
    portal/
      page.tsx         # billing portal (server component)
      cancel-button.tsx
    api/billing/
      setup-mandate/route.ts
      verify-mandate/route.ts
      subscribe/route.ts
      webhook/route.ts     # raw-body webhook receiver
      entitlement/route.ts
      cancel/route.ts
prisma/
  schema.prisma        # copy of the prisma-adapter schema (kit owns the tables)
```

## Setup

From the repo root:

```bash
# 1. Install (workspace deps are linked automatically)
pnpm install

# 2. Configure env
cp packages/nextjs-example/.env.example packages/nextjs-example/.env
#   fill in DATABASE_URL, Razorpay TEST MODE keys, webhook secret,
#   and BILLING_PREVIEW_TOKEN_SECRET

# 3. Generate the Prisma client + create the schema
pnpm --filter razorpay-recurring-upi-example db:generate
pnpm --filter razorpay-recurring-upi-example db:migrate

# 4. Run the app
pnpm --filter razorpay-recurring-upi-example dev
```

Then open <http://localhost:3000>.

> The billing tables are owned by the kit. This app's `prisma/schema.prisma` is a
> copy of the prisma-adapter schema so it can run its own migrations against the
> same database. If you already migrated via the prisma-adapter package, you can
> skip step 3's `db:migrate`.

## Testing with Razorpay test mode

1. Use **test mode** keys only (`rzp_test_...`). Get them from the Razorpay
   dashboard → API Keys → test tab.
2. On the pricing page, pick a plan and an available recurring method, then
   **Authorize & Subscribe**. Razorpay's test checkout opens.
3. For UPI Autopay in test mode, use the test VPA / flows from the Razorpay docs
   (e.g. `success@razorpay`). No real money moves.
4. Razorpay test mode does not support recurring **Card AutoPay** setup. The
   example hides/rejects card recurring when `RAZORPAY_KEY_ID` starts with
   `rzp_test_`; use live-mode recurring approval before testing card AutoPay.
5. After the checkout completes, the app verifies the mandate, creates the
   subscription, and charges the first invoice. Watch the terminal for the charge
   result.
6. View the result at `/portal?customerId=<your customer id>`.

## Webhooks (ngrok)

Razorpay webhooks can't reach `localhost`. Expose your dev server with ngrok:

```bash
ngrok http 3000
```

In the Razorpay dashboard → Settings → Webhooks, add the ngrok URL with the path
`/api/billing/webhook`, and copy the **webhook secret** into
`RAZORPAY_WEBHOOK_SECRET` (`.env`). Restart the app so the new secret is loaded.

The webhook route reads the **raw** request body and passes it verbatim to
`billing.webhooks.process` — the signature is computed over the raw bytes, so the
body must not be JSON-parsed first.

Reconciliation is idempotent: a replayed `x-razorpay-event-id` is skipped.

## API reference

| Method | Route | Body / Query | Returns |
| --- | --- | --- | --- |
| POST | `/api/billing/setup-mandate` | `{ customerId, email, name, contact, method }` | checkout data |
| POST | `/api/billing/verify-mandate` | `{ authorizationId, razorpay_payment_id, razorpay_order_id, razorpay_signature }` | `{ mandateId }` |
| POST | `/api/billing/subscribe` | `{ customerId, mandateId, planId }` | `{ subscriptionId, invoiceId, charge }` |
| POST | `/api/billing/webhook` | raw body + `X-Razorpay-Signature` header | `ok` |
| GET | `/api/billing/entitlement` | `?customerId=` | access decision |
| POST | `/api/billing/cancel` | `{ subscriptionId, timing }` | updated subscription |

## Compliance disclaimer

This is a **reference example**, not a turnkey payment product. Production use
requires (non-exhaustive): valid Razorpay live-mode approval for recurring
payments, PCI-aware handling of any card data, RBI e-mandate compliance (pre-
debit notifications, mandate registration flows, caps and frequencies), GST
invoicing, audit logging, and your own legal/privacy review. The kit handles
billing state and provider integration; it does not make you compliant on its
own.
