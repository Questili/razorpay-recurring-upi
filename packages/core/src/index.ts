/**
 * @questili/razorpay-recurring-upi
 *
 * Storage-neutral SaaS billing primitives for Razorpay recurring payments
 * (UPI Autopay, cards, e-mandates) over mandate-token payment rails.
 * Razorpay Recurring Payments is the first adapter (shipped separately).
 */

// Facade
export { createRazorpayRecurringUpiBilling, validateConfig } from "./api/create-billing.js";
export type { Billing } from "./api/create-billing.js";

// Errors
export { BillingError, isBillingError, notFound, invalidArgument, illegalTransition } from "./errors.js";
export type { BillingErrorCode } from "./errors.js";

// Clock / logger / ids
export { systemClock, FixedClock } from "./clock.js";
export type { Clock } from "./clock.js";
export { silentLogger, consoleLogger } from "./logger.js";
export type { Logger } from "./logger.js";
export { randomIdFactory, sequentialIdFactory } from "./ids.js";
export type { IdFactory } from "./ids.js";

// Enums
export type * from "./types/enums.js";

// Records
export type * from "./types/records.js";

// Config (BillingPlan resolves to the stored record via the records re-export below,
// so storage adapters and hosts share one plan type. BillingConfig.plans uses the
// config/input shape internally.)
export type { BillingConfig, CreateBillingOptions, ProviderRegistry } from "./types/config.js";
export type { BillingPlan as BillingPlanInput } from "./types/config.js";

// API surface
export type * from "./types/api.js";

// Events
export type { NormalizedBillingEvent, OperationalContext } from "./types/events.js";

// Storage interface + in-memory adapter
export type { BillingStorage } from "./storage/types.js";
export { InMemoryBillingStorage } from "./storage/in-memory.js";
export type { InMemoryStorageOptions } from "./storage/in-memory.js";

// Provider contract
export type * from "./providers/types.js";

// Domain logic (advanced/test use; pure functions)
export { computeProration } from "./domain/proration.js";
export type { ProrationInput, ProrationResult } from "./domain/proration.js";
export { buildInvoice, chargeableAmount } from "./domain/invoice.js";
export type { DraftInvoice, DraftInvoiceLine, InvoiceBuildInput } from "./domain/invoice.js";
export {
  validateDiscountCode,
  shouldApplyDiscount,
  discountAmount,
  redemptionCountForSubscription
} from "./domain/discount.js";
export { computeEntitlement } from "./domain/entitlement.js";
export type { AccessDecision } from "./domain/entitlement.js";
export { classifyFailure, nextRetryAt, DEFAULT_FAILURE_CONFIG } from "./domain/failure.js";
export type { FailureClassifierConfig, FailureClassification } from "./domain/failure.js";
export {
  subscriptionMachine,
  mandateMachine,
  invoiceMachine,
  chargeAttemptMachine,
  defineStateMachine
} from "./domain/state-machine.js";
export type { StateMachine } from "./domain/state-machine.js";
export { mandateHealth, canChargeMandate, exceedsMandateCap } from "./domain/mandate.js";
export { periodFor, addInterval, remainingFraction, DAY_MS } from "./domain/renewal-schedule.js";
export { roundPaise, assertSubunits, addSubunits, subtractSubunits, allocate, formatForDisplay } from "./domain/money.js";
