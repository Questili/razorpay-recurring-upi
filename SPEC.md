# SPEC: Razorpay Recurring UPI Kit

## Goal

Build a reusable open-source billing kit for SaaS products that need Razorpay recurring payments through UPI Autopay, cards, and e-mandates without outsourcing the whole subscription lifecycle to a closed customer portal.

The kit should provide provider-agnostic billing primitives, with Razorpay Recurring Payments as the first adapter. The public kit must not depend on Avalon or any host app.

## Core product requirements

- Register recurring payment mandates/tokens for UPI Autopay, cards, and e-mandates.
- Store mandate limits, frequency, method, status, and token identifiers.
- Own SaaS subscription state locally: plan, interval, renewal, entitlement, and cancellation.
- Generate invoices and line items for renewals, upgrades, discounts, and adjustments.
- Charge saved mandates/tokens for renewal and mid-cycle upgrade invoices.
- Support immediate upgrades when the invoice amount is within mandate limits.
- Require reauthorization when an invoice exceeds mandate limits or the mandate is inactive.
- Apply downgrades at the next renewal by default.
- Provide dunning state for retryable failures, pending UPI debits, halted mandates, and terminal failures.
- Normalize Razorpay webhooks into stable internal events.
- Expose primitives for a host app to build its own customer billing portal.

## Non-goals

- Do not build a general payment-provider abstraction in the initial OSS package.
- Do not build a complete hosted billing service.
- Do not make tax/legal claims beyond storing invoice metadata.
- Do not include Avalon-specific products, users, or entitlement policies.
- Do not require a specific database; ship storage interfaces and an example adapter.

## Provider strategy

Use Razorpay Recurring Payments / mandate tokens as the first-class Razorpay recurring payment rail.

Razorpay Subscriptions can be supported later as an adapter mode, but it should not be the default engine for this kit because the kit needs app-owned upgrade, proration, discount, dunning, and billing portal behavior.

### Razorpay Recurring Payments flow

1. Create or reuse a Razorpay customer.
2. Create an authorization order for UPI/card/e-mandate recurring payment.
3. Open Razorpay Checkout with recurring payment enabled.
4. Verify the checkout response server-side.
5. Fetch the authorization payment and extract `token_id`.
6. Store the mandate/token with max amount, method, frequency, expiry, and status.
7. Create a local subscription and invoice schedule.
8. For renewals/upgrades, create a local invoice, create a Razorpay order, and call Razorpay recurring payment API using the token.
9. Use webhooks plus API fetches to reconcile final payment state.

## Mandate policy

- Prefer UPI mandate frequency `as_presented` where supported by the merchant/account/payment method and product policy.
- Set `max_amount` high enough to cover likely upgrades, but show the user the mandate cap clearly.
- Never attempt a charge above the mandate max amount.
- If a mandate is paused, cancelled, expired, rejected, or invalid, mark the subscription as requiring reauthorization.
- For UPI, do not create another subsequent payment while a prior debit is unresolved.
- Treat payment processor timing and webhook delivery as eventually consistent.

## Subscription lifecycle

### States

- `draft` — local subscription initialized but no mandate/payment yet.
- `pending_authorization` — authorization order exists; user has not completed mandate registration.
- `active` — paid access is current and mandate is usable.
- `past_due` — renewal/upgrade payment failed but is retryable.
- `payment_pending` — provider has accepted/started debit, final result unresolved.
- `reauthorization_required` — mandate/token cannot be charged anymore or amount exceeds mandate cap.
- `cancel_at_period_end` — user canceled; access remains until period end.
- `canceled` — user or merchant canceled; access should stop according to `accessEndsAt`.
- `expired` — subscription period ended without renewal.

### Access policy

The kit returns entitlement state; the host app decides exact feature gating.

- `active` and `cancel_at_period_end` before `accessEndsAt` imply paid access.
- `payment_pending` keeps current access until a configured grace deadline.
- `past_due` can keep limited/full access during grace, depending on host config.
- `reauthorization_required`, `canceled`, and `expired` do not imply paid access after `accessEndsAt`.

## Plan changes

### Immediate upgrade

1. Preview the upgrade invoice.
2. Return an HMAC-signed preview token so confirmation cannot be forged or mutated client-side.
3. If invoice amount is within mandate max and mandate is active, allow confirmation.
4. Charge the invoice with the stored token.
5. Apply upgraded entitlement after payment is captured/confirmed.
6. If payment is pending, show pending state and keep old entitlement until success.
7. If payment fails, keep old entitlement and expose retry/reauthorization action.

### Downgrade

- Default to next renewal.
- Store pending plan/interval/effective date.
- Keep current entitlement until period end.

### Mandate cap exceeded

- Do not charge.
- Create a pending reauthorization flow with the target plan and required mandate max.
- Keep current subscription unchanged until reauthorization succeeds.

## Discounts

Discounts are app-owned, not provider-owned.

- Validate codes server-side before invoice creation.
- Apply discount effects in invoice calculation.
- Store redemption history in the kit.
- Do not require Razorpay Offers for v1.
- Support `percent`, `fixed_amount`, and `free_trial` discounts.
- Support `once`, `repeating`, and `forever` durations, with v1 implementation allowed to ship `once` and `repeating` first.

## Cancellations

- Default customer cancellation is end-of-period.
- Immediate cancellation requires explicit confirmation by the host app.
- Token/mandate cancellation should be attempted when the user wants to stop future debits.
- If provider token cancellation is pending/fails, keep local cancellation intent and surface an operational retry state.

## Dunning and retries

Classify failures as:

- `retryable`: temporary bank, PSP, timeout, insufficient funds.
- `reauthorization_required`: mandate cancelled, expired, paused, invalid token, blocked instrument.
- `support_required`: ambiguous processor state, reconciliation mismatch, provider API inconsistency.
- `terminal`: user revoked mandate or merchant canceled and no retry should occur.

For UPI:

- Respect pre-debit notification requirements.
- Do not submit overlapping debits for the same token/cycle.
- Wait for pending payment resolution before retrying.

## Public package outputs

The package should eventually publish:

- TypeScript core library.
- Razorpay adapter.
- In-memory test storage adapter.
- Prisma example storage adapter.
- Webhook verification helpers.
- Scheduler job helpers.
- Next.js example billing portal.
- Documentation on Razorpay recurring UPI gotchas.
