/**
 * Razorpay Recurring Payments adapter. Implements the kit's
 * {@link RecurringPaymentProvider} contract over Razorpay's REST API:
 *
 *  - customer create/reuse
 *  - authorization order creation (UPI / card / e-mandate)
 *  - checkout callback verification (HMAC) + token extraction
 *  - subsequent charge order + /payments/create/recurring
 *  - token cancellation and status fetch
 *  - webhook signature verification + payload normalization
 *
 * Provider HTTP errors during a charge are translated into a `failed` result
 * (with failure metadata) rather than thrown, so the core can classify them.
 */
import type {
  BillingMethod,
  CancelTokenResult,
  ChargeOrderResult,
  CreateAuthorizationResult,
  CreateRecurringPaymentResult,
  MandateStatus,
  PaymentStatusResult,
  ProviderCustomerResult,
  RecurringPaymentProvider,
  TokenStatusResult,
  VerifyAuthorizationResult,
  WebhookNormalizeResult
} from "@questili/razorpay-recurring-upi";
import { RazorpayClient } from "./client.js";
import { createFetchTransport, isRazorpayErrorBody, RazorpayHttpError } from "./transport.js";
import { assertRecurringMethodAvailableInMode, resolveBaseUrl, validateOptions } from "./config.js";
import type { RazorpayProviderOptions } from "./config.js";
import {
  computeCheckoutSignature,
  verifyCheckoutSignature,
  verifyWebhookSignature as verifyWebhookSignatureCrypto
} from "./crypto.js";
import {
  errorBodyToFailure,
  paymentStatusToState,
  safeLabelForPayment,
  tokenStatusToMandate,
  webhookPayloadToEvents
} from "./map.js";
import type { RazorpayWebhookPayload } from "./types.js";

export interface RazorpayProviderDeps {
  client: RazorpayClient;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export function createRazorpayProvider(options: RazorpayProviderOptions): RecurringPaymentProvider {
  validateOptions(options);
  const baseUrl = resolveBaseUrl(options);
  const transport = createFetchTransport(baseUrl, options.keyId, options.keySecret);
  const client = new RazorpayClient(transport, options.methodEndpoint);
  return createRazorpayProviderWithClient({
    client,
    keyId: options.keyId,
    keySecret: options.keySecret,
    webhookSecret: options.webhookSecret
  });
}

/** Build the adapter against an injected client (used by tests with a fake transport). */
export function createRazorpayProviderWithClient(deps: RazorpayProviderDeps): RecurringPaymentProvider {
  const { client, keyId, keySecret, webhookSecret } = deps;

  async function createOrReuseCustomer(input: {
    providerCustomerId?: string | null;
    email: string | null;
    name: string | null;
    contact: string | null;
  }): Promise<ProviderCustomerResult> {
    if (input.providerCustomerId) {
      const existing = await client.getCustomer(input.providerCustomerId);
      return { providerCustomerId: existing.id, created: false };
    }
    const created = await client.createCustomer({
      name: input.name ?? undefined,
      email: input.email ?? undefined,
      contact: input.contact ?? undefined,
      fail_existing: 0
    });
    return { providerCustomerId: created.id, created: true };
  }

  async function createAuthorization(input: {
    providerCustomerId: string;
    method: BillingMethod;
    amount: number;
    currency: string;
    mandate: { maxAmount: number; frequency: string | null; expiresAt: Date | null };
    notes?: Record<string, string>;
  }): Promise<CreateAuthorizationResult> {
    assertRecurringMethodAvailableInMode(input.method, keyId);
    const body = {
      customer_id: input.providerCustomerId,
      amount: input.amount,
      currency: input.currency,
      frequency: input.mandate.frequency ?? "as_presented",
      max_amount: input.mandate.maxAmount,
      ...(input.mandate.expiresAt ? { expire_at: Math.floor(input.mandate.expiresAt.getTime() / 1000) } : {}),
      notes: input.notes ?? {}
    };
    const res = await client.createAuthorization(input.method, body);
    return {
      providerOrderId: res.razorpay_order_id,
      checkout: {
        keyId,
        orderId: res.razorpay_order_id,
        customerId: input.providerCustomerId,
        recurring: "1",
        method: input.method
      }
    };
  }

  async function verifyAuthorization(input: {
    providerOrderId: string;
    providerPaymentId: string;
    providerSignature: string;
    method: BillingMethod;
  }): Promise<VerifyAuthorizationResult> {
    const valid = verifyCheckoutSignature(input.providerOrderId, input.providerPaymentId, input.providerSignature, keySecret);
    if (!valid) {
      throw new Error(
        `Razorpay checkout signature verification failed (order=${input.providerOrderId}, payment=${input.providerPaymentId})`
      );
    }
    const payment = await client.fetchPayment(input.providerPaymentId);
    const providerTokenId =
      (payment.recurring_details as { token_id?: string } | undefined)?.token_id ?? payment.token_id ?? "";
    if (!providerTokenId) {
      throw new Error(`Could not extract token_id from Razorpay payment ${input.providerPaymentId}`);
    }

    // Fetch the token for accurate status / max_amount / expiry.
    let status: MandateStatus = "confirmed";
    let maxAmount = 0;
    let expiresAt: Date | null = null;
    let frequency: string | null = null;
    try {
      const token = await client.fetchToken(providerTokenId);
      status = tokenStatusToMandate(token.status);
      maxAmount = token.max_amount ?? token.recurring_details?.max_amount ?? 0;
      frequency = (token as { frequency?: string }).frequency ?? null;
      if (token.expire_at) expiresAt = new Date(token.expire_at * 1000);
    } catch {
      // Token fetch is best-effort; a successful authorization implies confirmed.
      status = "confirmed";
    }

    return {
      providerPaymentId: payment.id,
      providerTokenId,
      status,
      maxAmount,
      frequency,
      expiresAt,
      safeInstrumentLabel: safeLabelForPayment(payment),
      providerMetadata: { orderId: input.providerOrderId, paymentStatus: payment.status }
    };
  }

  async function createChargeOrder(input: {
    providerCustomerId: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    notes?: Record<string, string>;
  }): Promise<ChargeOrderResult> {
    const order = await client.createOrder({
      amount: input.amount,
      currency: input.currency,
      receipt: input.idempotencyKey,
      notes: input.notes ?? {}
    });
    return { providerOrderId: order.id };
  }

  async function createRecurringPayment(input: {
    providerCustomerId: string;
    providerTokenId: string;
    amount: number;
    currency: string;
    providerOrderId: string;
    contact: string | null;
    email: string | null;
    idempotencyKey: string;
    notes?: Record<string, string>;
  }): Promise<CreateRecurringPaymentResult> {
    try {
      const payment = await client.createRecurringPayment({
        token_id: input.providerTokenId,
        amount: input.amount,
        currency: input.currency,
        contact: input.contact ?? "",
        email: input.email ?? "",
        order_id: input.providerOrderId,
        customer_id: input.providerCustomerId,
        notes: { idempotency_key: input.idempotencyKey, ...(input.notes ?? {}) }
      });
      const state = paymentStatusToState(payment.status);
      return {
        providerPaymentId: payment.id,
        state,
        failure: state === "failed"
          ? {
              providerErrorCode: payment.error_code ?? undefined,
              providerErrorDescription: payment.error_description ?? payment.error_reason ?? undefined
            }
          : null
      };
    } catch (err) {
      if (err instanceof RazorpayHttpError && err.errorBody) {
        return {
          providerPaymentId: null,
          state: "failed",
          failure: errorBodyToFailure(err.errorBody, `HTTP_${err.status}`)
        };
      }
      // Network / unexpected error -> retryable failure classification in core.
      return {
        providerPaymentId: null,
        state: "failed",
        failure: { providerErrorDescription: err instanceof Error ? err.message : String(err), providerStatus: "network_error" }
      };
    }
  }

  async function cancelToken(input: { providerTokenId: string }): Promise<CancelTokenResult> {
    try {
      const token = await client.cancelToken(input.providerTokenId);
      const status = tokenStatusToMandate(token.status);
      return { cancelled: status === "cancelled", status };
    } catch (err) {
      // Surface as not-yet-cancelled so the host can retry; core keeps local intent.
      if (err instanceof RazorpayHttpError && err.errorBody) {
        return { cancelled: false, status: tokenStatusToMandate(err.errorBody.error.code) };
      }
      return { cancelled: false, status: "unknown" };
    }
  }

  async function fetchTokenStatus(providerTokenId: string): Promise<TokenStatusResult> {
    const token = await client.fetchToken(providerTokenId);
    return {
      providerTokenId: token.id,
      status: tokenStatusToMandate(token.status),
      maxAmount: token.max_amount ?? token.recurring_details?.max_amount ?? 0,
      expiresAt: token.expire_at ? new Date(token.expire_at * 1000) : null
    };
  }

  async function fetchPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const payment = await client.fetchPayment(providerPaymentId);
    return {
      providerPaymentId: payment.id,
      state: paymentStatusToState(payment.status),
      amount: payment.amount,
      failure:
        payment.status.toLowerCase() === "failed"
          ? { providerErrorCode: payment.error_code ?? undefined, providerErrorDescription: payment.error_description ?? undefined }
          : null
    };
  }

  async function verifyWebhookSignature(input: { rawBody: string; signature: string | null }): Promise<boolean> {
    if (!input.signature) return false;
    return verifyWebhookSignatureCrypto(input.rawBody, input.signature, webhookSecret);
  }

  async function normalizeWebhook(input: { rawBody: string; signature: string | null; providerEventId: string | null }): Promise<WebhookNormalizeResult> {
    const verified = input.signature
      ? verifyWebhookSignatureCrypto(input.rawBody, input.signature, webhookSecret)
      : false;
    if (!verified) {
      return { verified: false, providerEventId: input.providerEventId, events: [], rawPayload: null };
    }
    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(input.rawBody) as RazorpayWebhookPayload;
    } catch {
      payload = { entity: "event", event: "unknown" };
    }
    return {
      verified: true,
      providerEventId: input.providerEventId,
      events: webhookPayloadToEvents(payload),
      rawPayload: payload
    };
  }

  return {
    name: "razorpay",
    createOrReuseCustomer,
    createAuthorization,
    verifyAuthorization,
    createChargeOrder,
    createRecurringPayment,
    cancelToken,
    fetchTokenStatus,
    fetchPaymentStatus,
    verifyWebhookSignature,
    normalizeWebhook
  };
}

/** Exposed for tests that need to compute the expected checkout signature. */
export { computeCheckoutSignature };
export type { RecurringPaymentProvider };
export { isRazorpayErrorBody };
