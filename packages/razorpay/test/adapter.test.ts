/**
 * Razorpay adapter tests against a fake HttpTransport. No network: every
 * Razorpay REST call is satisfied by a small route table that returns canned
 * Razorpay-shaped JSON (or throws RazorpayHttpError for the failure path).
 *
 * The adapter is built with createRazorpayProviderWithClient so we can inject a
 * RazorpayClient backed by the fake transport.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createRazorpayProviderWithClient,
  RazorpayClient,
  RazorpayHttpError,
  computeCheckoutSignature,
  computeWebhookSignature,
  isRazorpayTestModeKey,
  tokenStatusToMandate,
  paymentStatusToState,
  webhookPayloadToEvents,
  type HttpTransport,
  type TransportResponse
} from "@questili/razorpay-recurring-upi-provider";

const KEY_ID = "rzp_test_keyid";
const KEY_SECRET = "rzp_test_super_secret";
const WEBHOOK_SECRET = "wh_super_secret";

// ---------- fake transport ----------

type Handler = (body: object | undefined) => TransportResponse;
interface Route {
  method: "GET" | "POST";
  /** Substring/regex match against the request path. */
  match: RegExp;
  handler: Handler;
}

/**
 * Minimal fake transport. Routes are matched in order; the first matching route
 * handles the request. A handler may throw RazorpayHttpError to simulate a
 * provider error response.
 */
class FakeTransport implements HttpTransport {
  private routes: Route[] = [];
  readonly calls: Array<{ method: string; path: string; body?: object }> = [];

  on(method: "GET" | "POST", match: RegExp | string, handler: Handler): this {
    this.routes.push({ method, match: match instanceof RegExp ? match : new RegExp(match), handler });
    return this;
  }

  async request(method: "GET" | "POST", path: string, body?: object): Promise<TransportResponse> {
    this.calls.push({ method, path, body });
    for (const r of this.routes) {
      if (r.method === method && r.match.test(path)) {
        return r.handler(body);
      }
    }
    throw new RazorpayHttpError(404, `No fake route for ${method} ${path}`, null);
  }
}

function buildProvider(transport: FakeTransport, keyId = KEY_ID) {
  const client = new RazorpayClient(transport);
  return createRazorpayProviderWithClient({ client, keyId, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
}

// ---------- setup ----------

let transport: FakeTransport;
beforeEach(() => {
  transport = new FakeTransport();
});

// ---------- createOrReuseCustomer ----------

describe("adapter: createOrReuseCustomer", () => {
  it("POSTs /customers when no provider id is supplied and returns the new id", async () => {
    transport.on("POST", "/customers", () => ({ status: 201, body: { id: "cust_NEW", entity: "customer" } }));
    const provider = buildProvider(transport);

    const res = await provider.createOrReuseCustomer({
      billingCustomerId: "bill_1",
      providerCustomerId: null,
      email: "u@example.com",
      name: "User",
      contact: "9999999999"
    });
    expect(res.providerCustomerId).toBe("cust_NEW");
    expect(res.created).toBe(true);
    expect(transport.calls[0]!.method).toBe("POST");
    expect(transport.calls[0]!.path).toBe("/customers");
  });

  it("GETs the existing customer when a provider id is supplied", async () => {
    transport.on("GET", /\/customers\/cust_EXISTING$/, () => ({
      status: 200,
      body: { id: "cust_EXISTING", entity: "customer" }
    }));
    const provider = buildProvider(transport);

    const res = await provider.createOrReuseCustomer({
      billingCustomerId: "bill_1",
      providerCustomerId: "cust_EXISTING",
      email: null,
      name: null,
      contact: null
    });
    expect(res.providerCustomerId).toBe("cust_EXISTING");
    expect(res.created).toBe(false);
    expect(transport.calls[0]!.method).toBe("GET");
  });
});

// ---------- createAuthorization + verifyAuthorization ----------

describe("adapter: authorization", () => {
  it("createAuthorization returns a checkout with the provider order id", async () => {
    transport.on("POST", /createAuthorization$/, () => ({
      status: 200,
      body: { razorpay_order_id: "order_AUTH1" }
    }));
    const provider = buildProvider(transport);

    const res = await provider.createAuthorization({
      providerCustomerId: "cust_1",
      method: "upi",
      amount: 100,
      currency: "INR",
      mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
    });
    expect(res.providerOrderId).toBe("order_AUTH1");
    expect(res.checkout.orderId).toBe("order_AUTH1");
    expect(res.checkout.keyId).toBe(KEY_ID);
    expect(res.checkout.method).toBe("upi");
    expect(res.checkout.recurring).toBe("1");
  });

  it("rejects card authorization early when using Razorpay test mode keys", async () => {
    const provider = buildProvider(transport, "rzp_test_card_autopay");
    await expect(
      provider.createAuthorization({
        providerCustomerId: "cust_1",
        method: "card",
        amount: 100,
        currency: "INR",
        mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
      })
    ).rejects.toThrow(/card autopay recurring authorization is not supported/i);
    expect(transport.calls).toHaveLength(0);
  });

  it("allows card authorization when using a live mode key", async () => {
    transport.on("POST", /createAuthorization$/, () => ({
      status: 200,
      body: { razorpay_order_id: "order_CARD1" }
    }));
    const provider = buildProvider(transport, "rzp_live_card_autopay");

    const res = await provider.createAuthorization({
      providerCustomerId: "cust_1",
      method: "card",
      amount: 100,
      currency: "INR",
      mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
    });

    expect(res.providerOrderId).toBe("order_CARD1");
    expect(res.checkout.method).toBe("card");
    expect(res.checkout.keyId).toBe("rzp_live_card_autopay");
  });

  it("detects Razorpay test key prefixes", () => {
    expect(isRazorpayTestModeKey("rzp_test_abc")).toBe(true);
    expect(isRazorpayTestModeKey("rzp_live_abc")).toBe(false);
  });

  it("verifyAuthorization extracts the token and reports confirmed status from the token fetch", async () => {
    const orderId = "order_AUTH1";
    const paymentId = "pay_AUTH1";
    const sig = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);

    transport.on("GET", /\/payments\/pay_AUTH1$/, () => ({
      status: 200,
      body: {
        id: paymentId,
        entity: "payment",
        status: "captured",
        amount: 100,
        currency: "INR",
        method: "upi",
        recurring_details: { token_id: "token_AUTH1" }
      }
    }));
    transport.on("GET", /\/tokens\/token_AUTH1$/, () => ({
      status: 200,
      body: { id: "token_AUTH1", entity: "token", status: "active", method: "upi", max_amount: 500000 }
    }));

    const provider = buildProvider(transport);
    const res = await provider.verifyAuthorization({
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      providerSignature: sig,
      method: "upi"
    });

    expect(res.providerTokenId).toBe("token_AUTH1");
    expect(res.status).toBe("confirmed"); // token status "active" -> confirmed
    expect(res.maxAmount).toBe(500000);
  });

  it("verifyAuthorization throws on a bad signature", async () => {
    transport.on("GET", /\/payments\//, () => ({ status: 200, body: { id: "p", status: "captured" } }));
    const provider = buildProvider(transport);
    await expect(
      provider.verifyAuthorization({
        providerOrderId: "order_AUTH1",
        providerPaymentId: "pay_AUTH1",
        providerSignature: "bogus_signature",
        method: "upi"
      })
    ).rejects.toThrow(/signature verification failed/i);
    // No GET /payments call should have happened (signature checked first).
    expect(transport.calls.some((c) => c.method === "GET")).toBe(false);
  });
});

// ---------- createRecurringPayment ----------

describe("adapter: createRecurringPayment", () => {
  it("maps a captured payment to the captured state", async () => {
    transport.on("POST", "/orders", () => ({ status: 200, body: { id: "order_REC1", entity: "order", amount: 50000, amount_paid: 0, currency: "INR", status: "created" } }));
    transport.on("POST", "/payments/create/recurring", () => ({
      status: 200,
      body: { id: "pay_REC1", entity: "payment", status: "captured", amount: 50000, currency: "INR" }
    }));
    const provider = buildProvider(transport);

    const order = await provider.createChargeOrder({
      providerCustomerId: "cust_1",
      amount: 50000,
      currency: "INR",
      idempotencyKey: "k1",
      notes: {}
    });
    const res = await provider.createRecurringPayment({
      providerCustomerId: "cust_1",
      providerTokenId: "token_1",
      amount: 50000,
      currency: "INR",
      providerOrderId: order.providerOrderId,
      contact: null,
      email: null,
      idempotencyKey: "k1",
      notes: {}
    });
    expect(res.state).toBe("captured");
    expect(res.providerPaymentId).toBe("pay_REC1");
    expect(res.failure).toBeNull();
  });

  it("translates a RazorpayHttpError with an error body into a failed state carrying the provider error code", async () => {
    transport.on("POST", "/orders", () => ({ status: 200, body: { id: "order_REC2", entity: "order", amount: 50000, amount_paid: 0, currency: "INR", status: "created" } }));
    transport.on("POST", "/payments/create/recurring", () => {
      throw new RazorpayHttpError(
        400,
        "MANDATE_DECLINED: Mandate declined",
        { error: { code: "MANDATE_DECLINED", description: "Mandate declined" } }
      );
    });
    const provider = buildProvider(transport);

    const order = await provider.createChargeOrder({
      providerCustomerId: "cust_1",
      amount: 50000,
      currency: "INR",
      idempotencyKey: "k2",
      notes: {}
    });
    const res = await provider.createRecurringPayment({
      providerCustomerId: "cust_1",
      providerTokenId: "token_1",
      amount: 50000,
      currency: "INR",
      providerOrderId: order.providerOrderId,
      contact: null,
      email: null,
      idempotencyKey: "k2",
      notes: {}
    });
    expect(res.state).toBe("failed");
    expect(res.providerPaymentId).toBeNull();
    expect(res.failure?.providerErrorCode).toBe("MANDATE_DECLINED");
    expect(res.failure?.providerStatus).toBe("HTTP_400");
  });
});

// ---------- status mapping ----------

describe("adapter: token / payment status mapping", () => {
  it("tokenStatusToMandate maps Razorpay token statuses to kit mandate statuses", () => {
    expect(tokenStatusToMandate("active")).toBe("confirmed");
    expect(tokenStatusToMandate("paused")).toBe("paused");
    expect(tokenStatusToMandate("cancelled")).toBe("cancelled");
    expect(tokenStatusToMandate("revoked")).toBe("cancelled");
    expect(tokenStatusToMandate("expired")).toBe("expired");
    expect(tokenStatusToMandate("rejected")).toBe("rejected");
    expect(tokenStatusToMandate("created")).toBe("initiated");
    expect(tokenStatusToMandate(undefined)).toBe("unknown");
    expect(tokenStatusToMandate("WEIRD")).toBe("unknown");
  });

  it("paymentStatusToState maps Razorpay payment statuses to captured/failed/pending", () => {
    expect(paymentStatusToState("captured")).toBe("captured");
    expect(paymentStatusToState("failed")).toBe("failed");
    expect(paymentStatusToState("authorized")).toBe("pending");
    expect(paymentStatusToState("created")).toBe("pending");
    expect(paymentStatusToState("processing")).toBe("pending");
    expect(paymentStatusToState("pending")).toBe("pending");
    // Unknown defaults to pending so the scheduler reconciles.
    expect(paymentStatusToState("something_unexpected")).toBe("pending");
  });

  it("fetchTokenStatus maps through the client", async () => {
    transport.on("GET", /\/tokens\/token_X$/, () => ({
      status: 200,
      body: { id: "token_X", entity: "token", status: "active", method: "upi", max_amount: 250000 }
    }));
    const provider = buildProvider(transport);
    const res = await provider.fetchTokenStatus("token_X");
    expect(res.status).toBe("confirmed");
    expect(res.maxAmount).toBe(250000);
    expect(res.expiresAt).toBeNull();
  });

  it("fetchPaymentStatus maps a failed payment", async () => {
    transport.on("GET", /\/payments\/pay_X$/, () => ({
      status: 200,
      body: { id: "pay_X", entity: "payment", status: "failed", amount: 50000, currency: "INR", error_code: "BAD_ERROR" }
    }));
    const provider = buildProvider(transport);
    const res = await provider.fetchPaymentStatus("pay_X");
    expect(res.state).toBe("failed");
    expect(res.failure?.providerErrorCode).toBe("BAD_ERROR");
  });
});

// ---------- webhook normalization + event parsing ----------

describe("adapter: webhookPayloadToEvents", () => {
  const at = new Date("2026-01-01T00:00:00Z");
  const ts = Math.floor(at.getTime() / 1000);

  it("parses payment.captured into a captured event", () => {
    const events = webhookPayloadToEvents({
      entity: "event",
      event: "payment.captured",
      created_at: ts,
      payload: { payment: { entity: { id: "pay_1", amount: 50000, order_id: "order_1" } } }
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "payment.captured", providerPaymentId: "pay_1", amount: 50000 });
    expect((events[0] as { at: Date }).at.getTime()).toBe(at.getTime());
  });

  it("parses payment.failed with failure metadata", () => {
    const events = webhookPayloadToEvents({
      entity: "event",
      event: "payment.failed",
      created_at: ts,
      payload: {
        payment: { entity: { id: "pay_2", amount: 50000, error_code: "INSUFFICIENT_FUNDS", error_description: "no funds" } }
      }
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("payment.failed");
    const failed = events[0] as { failure: { providerErrorCode?: string } };
    expect(failed.failure.providerErrorCode).toBe("INSUFFICIENT_FUNDS");
  });

  it("parses token.* events into mandate.status events", () => {
    const events = webhookPayloadToEvents({
      entity: "event",
      event: "token.cancelled",
      created_at: ts,
      payload: { token: { entity: { id: "token_1", status: "cancelled" } } }
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "mandate.status", providerTokenId: "token_1", status: "cancelled" });
  });

  it("falls back to an unknown event when nothing is recognized", () => {
    const events = webhookPayloadToEvents({ entity: "event", event: "settlement.processed" });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("unknown");
  });
});

describe("adapter: normalizeWebhook", () => {
  it("verifies + returns events for a correctly signed payload", async () => {
    const rawBody = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", amount: 50000 } } }
    });
    const sig = computeWebhookSignature(rawBody, WEBHOOK_SECRET);
    const provider = buildProvider(transport);

    const res = await provider.normalizeWebhook({ rawBody, signature: sig, providerEventId: "evt_1" });
    expect(res.verified).toBe(true);
    expect(res.events).toHaveLength(1);
    expect(res.events[0]!.kind).toBe("payment.captured");
  });

  it("returns verified=false (and no events) for a bad signature or null signature", async () => {
    const provider = buildProvider(transport);
    const rawBody = JSON.stringify({ entity: "event", event: "payment.captured" });

    const bad = await provider.normalizeWebhook({ rawBody, signature: "deadbeef", providerEventId: "evt_2" });
    expect(bad.verified).toBe(false);
    expect(bad.events).toHaveLength(0);

    const nullSig = await provider.normalizeWebhook({ rawBody, signature: null, providerEventId: "evt_3" });
    expect(nullSig.verified).toBe(false);
  });

  it("verifyWebhookSignature returns false for a missing signature", async () => {
    const provider = buildProvider(transport);
    await expect(provider.verifyWebhookSignature({ rawBody: "{}", signature: null })).resolves.toBe(false);
  });
});
