# Data Model

The public kit should define storage-neutral records and ship adapters separately. Avalon can map these to Prisma tables.

## Entities

### BillingCustomer

Represents the host-app customer linked to one or more provider customers.

Fields:

- `id`
- `externalCustomerId` — host app user/account id
- `email`
- `name`
- `contact`
- `createdAt`
- `updatedAt`

### BillingProviderCustomer

Provider customer identity.

Fields:

- `id`
- `billingCustomerId`
- `provider` — initially `razorpay`
- `providerCustomerId`
- `metadata`
- unique `(provider, providerCustomerId)`

### BillingMandate

Stored recurring token/mandate.

Fields:

- `id`
- `billingCustomerId`
- `provider`
- `providerCustomerId`
- `providerTokenId`
- `authorizationPaymentId`
- `authorizationOrderId`
- `method` — `upi`, `card`, `emandate`
- `status` — `initiated`, `confirmed`, `rejected`, `cancelled`, `paused`, `expired`, `unknown`
- `currency`
- `maxAmount`
- `frequency`
- `expiresAt`
- `safeInstrumentLabel` — optional display text, never raw secrets
- `providerMetadata`
- timestamps

### BillingPlan

Host-configured plan snapshot.

Fields:

- `id`
- `name`
- `interval`
- `currency`
- `amount`
- `active`
- `metadata`

The host app can also keep plans in code and snapshot them into invoices/subscriptions.

### BillingSubscription

Local SaaS subscription.

Fields:

- `id`
- `billingCustomerId`
- `mandateId`
- `planId`
- `status`
- `currentPeriodStart`
- `currentPeriodEnd`
- `nextBillingAt`
- `accessEndsAt`
- `cancelAtPeriodEnd`
- `cancellationRequestedAt`
- `canceledAt`
- `pendingPlanId`
- `pendingPlanEffectiveAt`
- `metadata`
- timestamps

### BillingInvoice

Local billable invoice.

Fields:

- `id`
- `subscriptionId`
- `customerId`
- `status` — `draft`, `open`, `paid`, `void`, `uncollectible`
- `reason` — `initial`, `renewal`, `upgrade`, `manual_adjustment`
- `currency`
- `subtotal`
- `discountTotal`
- `taxTotal`
- `total`
- `periodStart`
- `periodEnd`
- `dueAt`
- timestamps

### BillingInvoiceLine

Invoice line items.

Fields:

- `id`
- `invoiceId`
- `type` — `plan`, `proration`, `discount`, `adjustment`
- `description`
- `quantity`
- `unitAmount`
- `amount`
- `periodStart`
- `periodEnd`
- `metadata`

### BillingChargeAttempt

One provider payment attempt.

Fields:

- `id`
- `invoiceId`
- `subscriptionId`
- `mandateId`
- `provider`
- `providerOrderId`
- `providerPaymentId`
- `status` — `scheduled`, `submitted`, `pending`, `captured`, `failed_retryable`, `failed_terminal`, `reauthorization_required`
- `amount`
- `currency`
- `failureCode`
- `failureReason`
- `nextRetryAt`
- `attemptNumber`
- `idempotencyKey`
- timestamps

### BillingDiscount

Provider-independent discount definition.

Fields:

- `id`
- `code`
- `type` — `percent`, `fixed_amount`, `free_trial`
- `value`
- `duration` — `once`, `repeating`, `forever`
- `durationInCycles`
- `validFrom`
- `validUntil`
- `maxRedemptions`
- `active`
- `appliesToPlanIds`
- `metadata`

### BillingDiscountRedemption

Fields:

- `id`
- `discountId`
- `customerId`
- `subscriptionId`
- `invoiceId`
- `redeemedAt`

### BillingWebhookEvent

Idempotency/audit record for provider webhooks.

Fields:

- `id`
- `provider`
- `providerEventId`
- `eventType`
- `processedAt`
- `status`
- `payloadHash`
- `error`
- unique `(provider, providerEventId)`

## Avalon Prisma mapping notes

Avalon already has `Premium` and `Payment` tied to Stripe fields. For Avalon integration:

- Add new provider-neutral tables instead of expanding more Stripe columns on `Premium`.
- Keep `Premium.tier` as a cache updated from billing state.
- Keep legacy Stripe columns for migration/compat, but stop using them as the canonical access source once billing tables are live.
- Existing `Payment` can be backfilled/bridged, but new kit-owned charge attempts should have their own table or a clear adapter into `Payment`.
