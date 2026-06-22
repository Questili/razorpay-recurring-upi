/**
 * Recurring payment provider contract. The core is provider-neutral and talks to
 * adapters through this interface. `razorpay` is the first implementation; the
 * shapes are deliberately generic so a future gateway adapter can implement them.
 *
 * Money is integer subunits. All methods are async because they perform I/O
 * against the provider. Adapters must be idempotent on the `idempotencyKey`
 * inputs they forward to the provider and/or use themselves.
 */
import type {
  BillingMethod,
  Currency,
  FailureClass,
  MandateStatus,
  ProviderName
} from "../types/enums.js";

export type { ProviderName };

/**
 * Provider-level webhook facts. The provider adapter parses its raw payload into
 * these provider-id-keyed events; the core then reconciles them onto kit records
 * and emits {@link NormalizedBillingEvent}s to operational hooks.
 */
export type ProviderWebhookEvent =
  | { kind: "mandate.status"; providerTokenId: string; status: MandateStatus; at: Date }
  | { kind: "payment.captured"; providerPaymentId: string; providerOrderId?: string; amount: number; at: Date }
  | { kind: "payment.authorized"; providerPaymentId: string; providerOrderId?: string; amount: number; at: Date }
  | {
      kind: "payment.failed";
      providerPaymentId: string | null;
      providerOrderId?: string;
      amount: number;
      failure: ProviderFailureInfo;
      at: Date;
    }
  | { kind: "refund.created"; providerPaymentId: string; amount: number; at: Date }
  | { kind: "unknown"; at: Date };

export interface ProviderCustomerInput {
  billingCustomerId: string;
  providerCustomerId?: string | null;
  email: string | null;
  name: string | null;
  contact: string | null;
}
export interface ProviderCustomerResult {
  providerCustomerId: string;
  created: boolean;
}

export interface MandateDefinition {
  maxAmount: number;
  frequency: string | null;
  expiresAt: Date | null;
}

export interface CreateAuthorizationInput {
  providerCustomerId: string;
  method: BillingMethod;
  /** Authorization amount (subunits), usually the provider minimum. */
  amount: number;
  currency: Currency;
  mandate: MandateDefinition;
  notes?: Record<string, string>;
}

/** Checkout data handed to the client SDK. Never raw secrets. */
export interface CheckoutData {
  keyId: string;
  orderId: string;
  customerId: string;
  recurring: "1" | "preferred";
  method: BillingMethod;
}

export interface CreateAuthorizationResult {
  providerOrderId: string;
  checkout: CheckoutData;
}

export interface VerifyAuthorizationInput {
  providerOrderId: string;
  providerPaymentId: string;
  providerSignature: string;
  method: BillingMethod;
}

export interface VerifyAuthorizationResult {
  providerPaymentId: string;
  providerTokenId: string;
  status: MandateStatus;
  maxAmount: number;
  frequency: string | null;
  expiresAt: Date | null;
  safeInstrumentLabel: string | null;
  providerMetadata: Record<string, unknown>;
}

export interface ChargeOrderInput {
  providerCustomerId: string;
  amount: number;
  currency: Currency;
  idempotencyKey: string;
  notes?: Record<string, string>;
}
export interface ChargeOrderResult {
  providerOrderId: string;
}

export type RecurringPaymentState = "captured" | "pending" | "failed";

export interface ProviderFailureInfo {
  providerErrorCode?: string | null;
  providerErrorDescription?: string | null;
  providerStatus?: string | null;
  providerPaymentStatus?: string | null;
  failureClass?: FailureClass;
}

export interface CreateRecurringPaymentInput {
  providerCustomerId: string;
  providerTokenId: string;
  amount: number;
  currency: Currency;
  providerOrderId: string;
  contact: string | null;
  email: string | null;
  idempotencyKey: string;
  notes?: Record<string, string>;
}

export interface CreateRecurringPaymentResult {
  providerPaymentId: string | null;
  state: RecurringPaymentState;
  failure: ProviderFailureInfo | null;
}

export interface CancelTokenInput {
  providerTokenId: string;
}
export interface CancelTokenResult {
  cancelled: boolean;
  status: MandateStatus;
}

export interface TokenStatusResult {
  providerTokenId: string;
  status: MandateStatus;
  maxAmount: number;
  expiresAt: Date | null;
}

export interface PaymentStatusResult {
  providerPaymentId: string;
  state: RecurringPaymentState;
  amount: number;
  failure: ProviderFailureInfo | null;
}

export interface WebhookVerifyInput {
  rawBody: string;
  signature: string | null;
}

export interface WebhookNormalizeInput {
  rawBody: string;
  signature: string | null;
  providerEventId: string | null;
}

export interface WebhookNormalizeResult {
  verified: boolean;
  providerEventId: string | null;
  /** Provider-level facts derived from the payload; the core reconciles them. */
  events: ProviderWebhookEvent[];
  /** Raw provider payload (parsed), for host-app audit/extension. */
  rawPayload: unknown;
}

/**
 * The provider adapter interface. Implementations may throw {@link BillingError}
 * with code `PROVIDER_ERROR` for unexpected provider responses.
 */
export interface RecurringPaymentProvider {
  readonly name: ProviderName;
  createOrReuseCustomer(input: ProviderCustomerInput): Promise<ProviderCustomerResult>;
  createAuthorization(input: CreateAuthorizationInput): Promise<CreateAuthorizationResult>;
  verifyAuthorization(input: VerifyAuthorizationInput): Promise<VerifyAuthorizationResult>;
  createChargeOrder(input: ChargeOrderInput): Promise<ChargeOrderResult>;
  createRecurringPayment(input: CreateRecurringPaymentInput): Promise<CreateRecurringPaymentResult>;
  cancelToken(input: CancelTokenInput): Promise<CancelTokenResult>;
  fetchTokenStatus(providerTokenId: string): Promise<TokenStatusResult>;
  fetchPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
  verifyWebhookSignature(input: WebhookVerifyInput): Promise<boolean>;
  normalizeWebhook(input: WebhookNormalizeInput): Promise<WebhookNormalizeResult>;
}
