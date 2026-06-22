/**
 * Mappers between Razorpay's shapes and the kit's provider contract. Centralizing
 * these keeps the brittle provider-specific field names in one place.
 */
import type {
  MandateStatus,
  ProviderFailureInfo,
  ProviderWebhookEvent,
  RecurringPaymentState
} from "@questili/razorpay-recurring-upi";
import type { RazorpayErrorBody, RazorpayPayment, RazorpayToken, RazorpayWebhookPayload } from "./types.js";

export function tokenStatusToMandate(status: string | undefined): MandateStatus {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "confirmed";
    case "paused":
      return "paused";
    case "cancelled":
    case "revoked":
      return "cancelled";
    case "expired":
      return "expired";
    case "rejected":
      return "rejected";
    case "created":
    case "initiated":
      return "initiated";
    default:
      return "unknown";
  }
}

export function paymentStatusToState(status: string | undefined): RecurringPaymentState {
  switch ((status ?? "").toLowerCase()) {
    case "captured":
      return "captured";
    case "failed":
      return "failed";
    case "authorized":
    case "created":
    case "pending":
    case "processing":
      return "pending";
    default:
      // Unknown / ambiguous: treat as pending so the scheduler reconciles.
      return "pending";
  }
}

/** Build a display-only instrument label from a payment. Never raw PAN/VPA. */
export function safeLabelForPayment(payment: RazorpayPayment): string | null {
  const method = (payment.method ?? "").toString().toLowerCase();
  const any = payment as Record<string, unknown>;
  if (method === "card") {
    const card = any["card"] as { last4?: string; network?: string } | undefined;
    if (card?.last4) return `${card.network ?? "Card"} ••${card.last4}`;
  }
  if (method === "upi") {
    const upi = any["vpa"] as string | undefined ?? (any["upi"] as { vpa?: string } | undefined)?.vpa;
    if (typeof upi === "string" && upi.length > 0) {
      const parts = upi.split("@");
      const handle = parts[0] ?? "";
      const tail = handle.slice(-4);
      return `UPI ••${tail}@${parts[1] ?? ""}`;
    }
  }
  if (method === "emandate" || method === "nach") {
    const bank = (any["bank"] as string | undefined) ?? "Bank";
    const last4 = (any["last4"] as string | undefined) ?? (any["mandate"] as { mandate_id?: string } | undefined)?.mandate_id;
    return last4 ? `${bank} ••${String(last4).slice(-4)}` : "eMandate";
  }
  return null;
}

export function errorBodyToFailure(errorBody: RazorpayErrorBody | null, fallbackStatus?: string): ProviderFailureInfo {
  if (!errorBody) {
    return { providerStatus: fallbackStatus ?? null };
  }
  return {
    providerErrorCode: errorBody.error.code,
    providerErrorDescription: errorBody.error.description,
    providerStatus: fallbackStatus ?? null
  };
}

/**
 * Convert a Razorpay webhook payload into provider-level events. Razorpay nests
 * the relevant entity under `payload.<entity>.entity`. We handle payment.* and
 * refund.* and token/mandate status changes.
 */
export function webhookPayloadToEvents(payload: RazorpayWebhookPayload): ProviderWebhookEvent[] {
  const events: ProviderWebhookEvent[] = [];
  const eventType = payload.event ?? "";
  const at = payload.created_at ? new Date(payload.created_at * 1000) : new Date(0);

  if (eventType.startsWith("payment.")) {
    const payment = payload.payload?.payment?.entity;
    if (payment?.id) {
      const amount = typeof payment.amount === "number" ? payment.amount : 0;
      const base = { providerPaymentId: payment.id, providerOrderId: payment.order_id ?? undefined, amount, at };
      if (eventType === "payment.captured") {
        events.push({ kind: "payment.captured", ...base });
      } else if (eventType === "payment.authorized") {
        events.push({ kind: "payment.authorized", ...base });
      } else if (eventType === "payment.failed") {
        events.push({
          kind: "payment.failed",
          providerPaymentId: payment.id,
          providerOrderId: payment.order_id ?? undefined,
          amount,
          failure: {
            providerErrorCode: payment.error_code ?? undefined,
            providerErrorDescription: payment.error_description ?? payment.error_reason ?? undefined
          },
          at
        });
      }
    }
    return events;
  }

  if (eventType.startsWith("refund.")) {
    const refund = payload.payload?.refund?.entity;
    if (refund?.id) {
      events.push({ kind: "refund.created", providerPaymentId: refund.id, amount: refund.amount ?? 0, at });
    }
    return events;
  }

  // Mandate / token status events (e.g. token.cancelled, mandate.expired).
  const token = payload.payload?.token?.entity as Partial<RazorpayToken> | undefined;
  if (token?.id && (eventType.startsWith("token.") || eventType.startsWith("mandate."))) {
    events.push({
      kind: "mandate.status",
      providerTokenId: token.id,
      status: tokenStatusToMandate(token.status ?? eventType.split(".")[1]),
      at
    });
  }

  if (events.length === 0) {
    events.push({ kind: "unknown", at });
  }
  return events;
}
