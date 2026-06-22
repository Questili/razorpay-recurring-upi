/**
 * Webhook processing tests. The base FakeProvider.normalizeWebhook verifies when
 * a signature is present and returns no events; here we subclass it to emit a
 * caller-staged provider event so we can drive payment.captured / payment.failed
 * reconciliation and duplicate-event idempotency deterministically, no network.
 */
import { describe, it, expect } from "vitest";
import {
  createTestBilling,
  FakeProvider,
  FixedClock,
  type TestBillingOverrides
} from "@questili/razorpay-recurring-upi/testing";
import type { ProviderWebhookEvent, WebhookNormalizeInput, WebhookNormalizeResult } from "@questili/razorpay-recurring-upi";

const START = new Date("2026-01-01T00:00:00Z");

/**
 * FakeProvider whose normalizeWebhook returns a caller-staged event when the
 * signature is present. Set `instance.nextEvent` before invoking
 * billing.webhooks.process. A null signature is still reported as unverified,
 * matching the base contract.
 */
class EventEmittingProvider extends FakeProvider {
  nextEvent: ProviderWebhookEvent | null = null;

  override async normalizeWebhook(input: WebhookNormalizeInput): Promise<WebhookNormalizeResult> {
    const verified = input.signature !== null;
    let rawPayload: unknown = {};
    try {
      rawPayload = JSON.parse(input.rawBody);
    } catch {
      rawPayload = {};
    }
    if (!verified) {
      return { verified: false, providerEventId: input.providerEventId, events: [], rawPayload };
    }
    const events = this.nextEvent ? [this.nextEvent] : [];
    return { verified: true, providerEventId: input.providerEventId, events, rawPayload };
  }
}

function harness(provider = new EventEmittingProvider()) {
  const clock = new FixedClock(START);
  const { billing, storage } = createTestBilling({ provider, clock });
  return { billing, storage, provider, clock };
}

async function registerMandate(billing: ReturnType<typeof createTestBilling>["billing"]) {
  await billing.customers.ensure({ id: "cust_ext_1", email: "u@example.com", name: "User", contact: "9999999999" });
  const auth = await billing.mandates.createAuthorization({
    customer: { id: "cust_ext_1", email: "u@example.com", name: "User", contact: "9999999999" },
    method: "upi",
    amount: 100,
    mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
  });
  return billing.mandates.verifyAuthorizationCallback({
    provider: "razorpay",
    authorizationId: auth.authorizationId,
    response: { razorpay_payment_id: "pay_abc", razorpay_order_id: auth.providerOrderId, razorpay_signature: "sig" }
  });
}

/** Advance past the calendar-month nextBillingAt and run the renewal as pending. */
async function pendingRenewalPaymentId(
  billing: ReturnType<typeof createTestBilling>["billing"],
  storage: ReturnType<typeof createTestBilling>["storage"],
  subscriptionId: string,
  clock: FixedClock
): Promise<string> {
  const sub = (await billing.subscriptions.get(subscriptionId))!;
  const delta = sub.nextBillingAt!.getTime() + 1000 - clock.now().getTime();
  clock.advance(delta);
  const [renewal] = await billing.renewals.runRenewals({ before: clock.now() });
  expect(renewal!.result.status).toBe("pending");
  const attempts = await storage.listChargeAttemptsBySubscription(subscriptionId);
  const pending = attempts.find((a) => a.status === "pending")!;
  return pending.providerPaymentId!;
}

describe("webhooks: verification + idempotency", () => {
  it("throws WEBHOOK_VERIFICATION_FAILED when the signature is null", async () => {
    const { billing } = harness();
    await expect(
      billing.webhooks.process({
        provider: "razorpay",
        rawBody: JSON.stringify({ event: "payment.captured" }),
        signature: null,
        providerEventId: "evt_1"
      })
    ).rejects.toMatchObject({ code: "WEBHOOK_VERIFICATION_FAILED" });
  });

  it("skips a duplicate providerEventId on replay (skipped_duplicate, no events)", async () => {
    const { billing, provider } = harness();
    provider.nextEvent = { kind: "unknown", at: START };
    const body = JSON.stringify({ event: "x" });

    const first = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_dup"
    });
    expect(first.status).toBe("processed");

    const replay = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_dup"
    });
    expect(replay.status).toBe("skipped_duplicate");
    expect(replay.events).toBe(0);
  });

  it("retries a failed webhook record instead of treating it as a duplicate", async () => {
    const { billing, provider, storage } = harness();
    provider.nextEvent = { kind: "unknown", at: START };
    const body = JSON.stringify({ event: "retryable" });

    const originalUpdateWebhookEvent = storage.updateWebhookEvent.bind(storage);
    let failProcessedUpdate = true;
    storage.updateWebhookEvent = async (id, patch) => {
      if (failProcessedUpdate && patch.status === "processed") {
        failProcessedUpdate = false;
        throw new Error("transient webhook audit write failure");
      }
      return originalUpdateWebhookEvent(id, patch);
    };

    const first = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_retry"
    });
    expect(first.status).toBe("failed");

    const replay = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_retry"
    });
    expect(replay.status).toBe("processed");
    expect(replay.events).toBe(1);
  });
});

describe("webhooks: payment.captured reconciliation", () => {
  it("marks an open (pending) renewal invoice paid when a payment.captured event arrives", async () => {
    const provider = new EventEmittingProvider();
    const { billing, storage, clock } = harness(provider);

    const verified = await registerMandate(billing);
    provider.behavior.nextPaymentState = "captured";
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    // Pending renewal leaves an open invoice + a pending charge attempt.
    provider.behavior.nextPaymentState = "pending";
    const paymentId = await pendingRenewalPaymentId(billing, storage, created.subscriptionId, clock);

    const renewalInvoice = (await billing.invoices.listBySubscription(created.subscriptionId)).find(
      (i) => i.reason === "renewal"
    )!;
    expect(renewalInvoice.status).not.toBe("paid");

    provider.nextEvent = {
      kind: "payment.captured",
      providerPaymentId: paymentId,
      amount: renewalInvoice.total,
      at: clock.now()
    };
    const result = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId } } } }),
      signature: "sig",
      providerEventId: "evt_capture_" + paymentId
    });
    expect(result.status).toBe("processed");
    expect(result.events).toBe(1);

    const after = (await billing.invoices.get(renewalInvoice.id))!;
    expect(after.status).toBe("paid");

    const sub = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(sub.status).toBe("active");
  });

  it("replaying a failed capture webhook completes invoice finalization after a partial attempt update", async () => {
    const provider = new EventEmittingProvider();
    const { billing, storage, clock } = harness(provider);

    const verified = await registerMandate(billing);
    provider.behavior.nextPaymentState = "captured";
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    provider.behavior.nextPaymentState = "pending";
    const paymentId = await pendingRenewalPaymentId(billing, storage, created.subscriptionId, clock);
    const renewalInvoice = (await billing.invoices.listBySubscription(created.subscriptionId)).find(
      (i) => i.reason === "renewal"
    )!;

    const originalUpdateInvoice = storage.updateInvoice.bind(storage);
    let failPaidWrite = true;
    storage.updateInvoice = async (id, patch) => {
      if (failPaidWrite && patch.status === "paid") {
        failPaidWrite = false;
        throw new Error("transient invoice write failure");
      }
      return originalUpdateInvoice(id, patch);
    };

    provider.nextEvent = {
      kind: "payment.captured",
      providerPaymentId: paymentId,
      amount: renewalInvoice.total,
      at: clock.now()
    };
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId } } } });

    const first = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_capture_retry_" + paymentId
    });
    expect(first.status).toBe("failed");

    const partialAttempt = (await storage.listChargeAttemptsBySubscription(created.subscriptionId)).find(
      (a) => a.providerPaymentId === paymentId
    )!;
    expect(partialAttempt.status).toBe("captured");
    expect((await billing.invoices.get(renewalInvoice.id))!.status).toBe("open");

    const replay = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: body,
      signature: "sig",
      providerEventId: "evt_capture_retry_" + paymentId
    });
    expect(replay.status).toBe("processed");
    expect((await billing.invoices.get(renewalInvoice.id))!.status).toBe("paid");
  });

  it("payment.failed reconciliation marks the attempt failed and the subscription past_due", async () => {
    const provider = new EventEmittingProvider();
    const { billing, storage, clock } = harness(provider);
    const verified = await registerMandate(billing);
    provider.behavior.nextPaymentState = "captured";
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    provider.behavior.nextPaymentState = "pending";
    const paymentId = await pendingRenewalPaymentId(billing, storage, created.subscriptionId, clock);

    provider.nextEvent = {
      kind: "payment.failed",
      providerPaymentId: paymentId,
      amount: 50000,
      failure: { providerErrorCode: "INSUFFICIENT_FUNDS", providerErrorDescription: "insufficient funds" },
      at: clock.now()
    };
    const result = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: paymentId } } } }),
      signature: "sig",
      providerEventId: "evt_failed_" + paymentId
    });
    expect(result.status).toBe("processed");

    const sub = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(sub.status).toBe("past_due");
  });

  it("processes an unknown event type without throwing (no-op reconcile)", async () => {
    const { billing, provider } = harness();
    provider.nextEvent = { kind: "unknown", at: START };
    const result = await billing.webhooks.process({
      provider: "razorpay",
      rawBody: JSON.stringify({ event: "something.else" }),
      signature: "sig",
      providerEventId: "evt_unknown"
    });
    expect(result.status).toBe("processed");
  });
});

void (null as unknown as TestBillingOverrides);
