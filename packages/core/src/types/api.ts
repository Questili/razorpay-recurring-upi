/**
 * Public API input/result types. These are the stable surface host apps program
 * against. Names track API-SKETCH.md; small extensions (failed_terminal, flags)
 * are additive.
 */
import type { BillingMethod, CancelReason, CancelTiming, Currency, FailureClass, PlanChangeTiming, ProviderName } from "./enums.js";
import type { AccessDecision } from "../domain/entitlement.js";

export interface CustomerInput {
  id: string;
  email: string | null;
  name: string | null;
  contact: string | null;
}

export interface MandateDefinitionInput {
  maxAmount: number;
  frequency: string | null;
  expiresAt: Date | null;
}

export interface CreateMandateAuthorizationInput {
  customer: CustomerInput;
  method: BillingMethod;
  amount: number;
  currency?: Currency;
  mandate: MandateDefinitionInput;
  metadata?: Record<string, string>;
}

export interface MandateAuthorization {
  authorizationId: string;
  provider: ProviderName;
  providerOrderId: string;
  providerCustomerId: string;
  checkout: {
    keyId: string;
    orderId: string;
    customerId: string;
    recurring: "1" | "preferred";
    method: BillingMethod;
  };
}

export interface VerifyAuthorizationCallbackInput {
  provider: ProviderName;
  authorizationId: string;
  response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  };
}

export interface VerifiedMandate {
  mandateId: string;
  providerTokenId: string;
  status: import("./enums.js").MandateStatus;
  method: BillingMethod;
  safeInstrumentLabel: string | null;
  maxAmount: number;
}

export interface CreateSubscriptionInput {
  customerId: string;
  mandateId: string;
  planId: string;
  startsAt?: Date;
  trialEndsAt?: Date | null;
  discountCodes?: string[];
  /** When provided and no active trial, the initial invoice is charged immediately. */
  idempotencyKey?: string;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
  invoiceId: string | null;
  charge?: ChargeResult;
}

export type ChargeResult =
  | { status: "captured"; invoiceId: string; chargeAttemptId: string }
  | { status: "pending"; invoiceId: string; chargeAttemptId: string }
  | { status: "failed_retryable"; invoiceId: string; chargeAttemptId: string; nextRetryAt: Date | null }
  | { status: "failed_terminal"; invoiceId: string; chargeAttemptId: string; reason: string }
  | { status: "reauthorization_required"; reason: string; invoiceId?: string; chargeAttemptId?: string }
  | { status: "skipped"; reason: string };

export interface ChargeDueInput {
  subscriptionId: string;
  idempotencyKey: string;
}

export interface CancelSubscriptionInput {
  subscriptionId: string;
  timing: CancelTiming;
  reason: CancelReason;
  /** For immediate cancellation, optionally cancel the provider mandate/token too. */
  cancelMandate?: boolean;
}

export interface PlanChangePreviewInput {
  subscriptionId: string;
  targetPlanId: string;
  timing: PlanChangeTiming;
  discountCodes?: string[];
}

export interface PlanChangePreview {
  id: string;
  subscriptionId: string;
  targetPlanId: string;
  timing: PlanChangeTiming;
  amountDue: number;
  subtotal: number;
  discountTotal: number;
  lines: Array<{ type: import("./enums.js").InvoiceLineType; description: string; amount: number }>;
  exceedsMandateCap: boolean;
  mandateUsable: boolean;
  effectiveAt: Date;
}

export interface ConfirmPlanChangeInput {
  subscriptionId: string;
  previewId: string;
  idempotencyKey: string;
}

export type PlanChangeResult = ChargeResult | { status: "scheduled"; subscriptionId: string; effectiveAt: Date };

export interface ValidateDiscountInput {
  code: string;
  customerId: string;
  planId: string;
}

export interface ValidateDiscountResult {
  valid: boolean;
  reason?: string;
  discountId?: string;
  type?: import("./enums.js").DiscountType;
  value?: number;
}

export interface ProcessWebhookInput {
  provider: ProviderName;
  rawBody: string;
  signature: string | null;
  providerEventId: string | null;
}

export interface ProcessWebhookResult {
  status: "processed" | "skipped_duplicate" | "failed";
  events: number;
  error?: string;
}

export interface EntitlementResult extends AccessDecision {
  subscriptionId: string | null;
  planId: string | null;
}

export type OperationalHook = (event: import("./events.js").NormalizedBillingEvent) => void | Promise<void>;
