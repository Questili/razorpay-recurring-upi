# Avalon Integration Plan

This document is for the follow-up Avalon implementation after the OSS planning docs are accepted.

## Integration principle

Avalon should keep existing Stripe behavior working while adding Razorpay recurring billing through this package. The public package should not import Avalon code or mention Stripe.

## Avalon phases

### Phase 1 — Provider-neutral billing foundation

- Add Avalon Prisma tables corresponding to the kit entities.
- Add an Avalon storage adapter for the kit.
- Backfill existing Stripe subscribers into provider-neutral billing records for entitlement reads only.
- Keep existing Stripe Checkout, webhook, and Billing Portal paths unchanged.
- Add provider-neutral entitlement helpers and migrate access checks away from `premium.stripeSubscriptionStatus`.

### Phase 2 — Razorpay mandate setup

- Add Razorpay env validation for key id, key secret, webhook secret, and Razorpay plan config.
- Add pricing UI provider choice for first payment.
- Build Razorpay mandate authorization endpoint using the package.
- Add checkout callback verification route.
- Add Razorpay webhook route using raw-body signature verification.
- Store mandate/token details through the kit storage adapter.

### Phase 3 — Razorpay billing portal

- Add provider-aware billing settings.
- Existing Stripe users continue seeing Stripe Billing Portal.
- Razorpay users see Avalon-owned billing management:
  - current plan
  - current renewal date
  - mandate method/status
  - cancel at period end
  - immediate cancellation with confirmation
  - pending payment/reauthorization warnings
  - invoice/payment history

### Phase 4 — Plan changes and discounts

- Add immediate upgrade previews and confirmations for Razorpay users.
- If upgrade invoice is within mandate cap, charge immediately and update entitlement after capture.
- If invoice exceeds cap or mandate inactive, require reauthorization.
- Apply downgrades at next renewal.
- Add provider-independent discount code validation and invoice calculation.

### Phase 5 — Scheduler and dunning

- Add cron/queue jobs for renewals, pending payment reconciliation, and retry attempts.
- Add alerts for support-required states.
- Add admin sync/retry controls.

## Provider lock rules in Avalon

- Existing Stripe subscribers stay on Stripe until manually migrated/canceled.
- New Razorpay recurring users get provider locked to Razorpay after successful mandate/subscription activation.
- A Premium account must have at most one active billing owner.
- Payment history may contain multiple providers over time, but active entitlement should come from one current billing subscription.

## Verification before release

Minimum checks after implementation begins:

- focused billing unit tests
- Razorpay webhook/signature tests
- plan-change tests
- cancellation/dunning tests
- `pnpm typecheck:web`
- `pnpm quality:check`
- `pnpm verify:handoff` before final handoff
