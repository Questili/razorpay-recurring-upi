/**
 * Stable domain enums. These are the single source of truth for status values
 * across the kit, storage adapters, providers, and the public API. They are
 * deliberately string-literal unions (not TS `enum`) so emitted JS carries no
 * runtime enum machinery and values stay JSON-serializable for storage.
 */

/** Recurring payment instrument registered against a mandate. */
export type BillingMethod = "upi" | "card" | "emandate";

/** Provider identifier. `razorpay` is the first adapter; the core is neutral. */
export type ProviderName = "razorpay";

/** ISO-4217 lower-cased. v1 ships INR; the type is open for future gateways. */
export type Currency = "INR";

/** Plan billing cadence. */
export type PlanInterval = "monthly" | "annual";

/** Mandate / token lifecycle as reported (and normalized) by the provider. */
export type MandateStatus =
  | "initiated"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "paused"
  | "expired"
  | "unknown";

/** Whether a mandate can still be charged for a given amount. */
export type MandateHealth = "usable" | "paused" | "inactive";

/**
 * Subscription lifecycle per SPEC. The kit owns this state machine; the host app
 * reads entitlement from it but must not mutate raw status.
 */
export type SubscriptionStatus =
  | "draft"
  | "pending_authorization"
  | "active"
  | "past_due"
  | "payment_pending"
  | "reauthorization_required"
  | "cancel_at_period_end"
  | "canceled"
  | "expired";

/** Invoice lifecycle. */
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

/** Why an invoice was generated. Drives line-item generation rules. */
export type InvoiceReason = "initial" | "renewal" | "upgrade" | "manual_adjustment";

/** Invoice line classification. */
export type InvoiceLineType = "plan" | "proration" | "discount" | "adjustment";

/** One provider payment attempt lifecycle. */
export type ChargeAttemptStatus =
  | "scheduled"
  | "submitted"
  | "pending"
  | "captured"
  | "failed_retryable"
  | "failed_terminal"
  | "reauthorization_required";

/** Discount effect shape. */
export type DiscountType = "percent" | "fixed_amount" | "free_trial";

/** How long a discount applies across invoices. */
export type DiscountDuration = "once" | "repeating" | "forever";

/**
 * Failure classification per SPEC "Dunning and retries". This drives retry
 * policy, reauthorization flows, and support escalation.
 */
export type FailureClass =
  | "retryable"
  | "reauthorization_required"
  | "support_required"
  | "terminal";

/** Cancellation timing. */
export type CancelTiming = "period_end" | "immediate";

/** Cancellation initiator. */
export type CancelReason =
  | "user_requested"
  | "merchant_initiated"
  | "mandate_revoked"
  | "payment_failed_terminal";

/** Access decision reason returned by the entitlement engine. */
export type AccessReason =
  | "active"
  | "cancel_at_period_end"
  | "grace"
  | "trial"
  | "pending_authorization"
  | "no_subscription"
  | "inactive"
  | "expired";

/** Plan-change timing. */
export type PlanChangeTiming = "immediate" | "period_end";
