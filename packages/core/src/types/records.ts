/**
 * Storage-neutral domain records. These mirror DATA-MODEL.md exactly and are the
 * contract every storage adapter (in-memory, Prisma, …) must persist. All money
 * is integer subunits (paise). Timestamps are Date (adapters serialize as needed).
 */
import type {
  BillingMethod,
  CancelReason,
  ChargeAttemptStatus,
  Currency,
  DiscountDuration,
  DiscountType,
  InvoiceLineType,
  InvoiceReason,
  InvoiceStatus,
  MandateStatus,
  PlanInterval,
  ProviderName,
  SubscriptionStatus
} from "./enums.js";

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Host-app customer linked to one or more provider customers. */
export interface BillingCustomer extends BaseEntity {
  externalCustomerId: string;
  email: string | null;
  name: string | null;
  contact: string | null;
}

/** Provider-side customer identity (e.g. a Razorpay customer id). */
export interface BillingProviderCustomer extends BaseEntity {
  billingCustomerId: string;
  provider: ProviderName;
  providerCustomerId: string;
  metadata: Record<string, unknown>;
}

/** Stored recurring token/mandate. Never contains raw secrets. */
export interface BillingMandate extends BaseEntity {
  billingCustomerId: string;
  provider: ProviderName;
  providerCustomerId: string;
  providerTokenId: string | null;
  authorizationPaymentId: string | null;
  authorizationOrderId: string | null;
  method: BillingMethod;
  status: MandateStatus;
  currency: Currency;
  /** Max single-charge amount in subunits. Charges above this must not be attempted. */
  maxAmount: number;
  frequency: string | null;
  expiresAt: Date | null;
  /** Display-only label (e.g. "HDFC ••4242", VPA last segment). Never raw PAN/VPA. */
  safeInstrumentLabel: string | null;
  providerMetadata: Record<string, unknown>;
}

/** Host-configured plan snapshot. */
export interface BillingPlan extends BaseEntity {
  name: string;
  interval: PlanInterval;
  currency: Currency;
  amount: number;
  active: boolean;
  features: string[];
  metadata: Record<string, string>;
}

/** Local SaaS subscription. */
export interface BillingSubscription extends BaseEntity {
  billingCustomerId: string;
  mandateId: string | null;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingAt: Date | null;
  accessEndsAt: Date;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt: Date | null;
  canceledAt: Date | null;
  cancelReason: CancelReason | null;
  pendingPlanId: string | null;
  pendingPlanEffectiveAt: Date | null;
  trialEndsAt: Date | null;
  metadata: Record<string, unknown>;
}

/** Local billable invoice. */
export interface BillingInvoice extends BaseEntity {
  subscriptionId: string;
  customerId: string;
  status: InvoiceStatus;
  reason: InvoiceReason;
  currency: Currency;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  paidAt: Date | null;
  metadata: Record<string, unknown>;
}

/** Invoice line item. */
export interface BillingInvoiceLine extends BaseEntity {
  invoiceId: string;
  type: InvoiceLineType;
  description: string;
  quantity: number;
  unitAmount: number;
  /** Signed subunits. Negative for credits/discounts. */
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  metadata: Record<string, unknown>;
}

/** One provider payment attempt for an invoice. */
export interface BillingChargeAttempt extends BaseEntity {
  invoiceId: string;
  subscriptionId: string;
  mandateId: string;
  provider: ProviderName;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: ChargeAttemptStatus;
  amount: number;
  currency: Currency;
  failureClass: import("./enums.js").FailureClass | null;
  failureCode: string | null;
  failureReason: string | null;
  nextRetryAt: Date | null;
  attemptNumber: number;
  idempotencyKey: string;
  providerRequestRef: string | null;
}

/** Provider-independent discount definition. */
export interface BillingDiscount extends BaseEntity {
  code: string;
  type: DiscountType;
  /** Percent (0-100) for `percent`, subunits for `fixed_amount`, cycles for `free_trial`. */
  value: number;
  duration: DiscountDuration;
  durationInCycles: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  active: boolean;
  appliesToPlanIds: string[] | null;
  metadata: Record<string, unknown>;
}

/** A redemption of a discount against a customer/subscription/invoice. */
export interface BillingDiscountRedemption extends BaseEntity {
  discountId: string;
  customerId: string;
  subscriptionId: string | null;
  invoiceId: string | null;
  redeemedAt: Date;
}

/** Idempotency/audit record for provider webhooks. */
export interface BillingWebhookEvent extends BaseEntity {
  provider: ProviderName;
  providerEventId: string;
  eventType: string;
  processedAt: Date | null;
  status: "processed" | "skipped_duplicate" | "failed";
  payloadHash: string;
  error: string | null;
}
