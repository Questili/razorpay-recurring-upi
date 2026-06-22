/**
 * Integration lifecycle tests driven through the public facade
 * (createRazorpayRecurringUpiBilling) wired to the in-memory storage + FakeProvider.
 *
 * The FakeProvider captures by default; its `behavior` field is mutated between
 * tests to drive pending / failed / reauthorization outcomes. The FixedClock
 * makes renewals, retries, and grace deterministic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestBilling,
  FakeProvider,
  FixedClock,
  InMemoryBillingStorage,
  sequentialIdFactory,
  defaultTestConfig,
  type TestBillingOverrides
} from "@questili/razorpay-recurring-upi/testing";
import type { NormalizedBillingEvent } from "@questili/razorpay-recurring-upi";

const START = new Date("2026-01-01T00:00:00Z");

/**
 * Advance the FixedClock past a subscription's nextBillingAt. The kit bills on
 * calendar months (Jan 1 -> Feb 1 = 31 days), so we read the actual due date
 * rather than assuming a fixed 30-day month.
 */
function advancePastRenewal(clock: FixedClock, nextBillingAt: Date, paddingMs = 1000): void {
  const target = nextBillingAt.getTime() + paddingMs;
  const delta = target - clock.now().getTime();
  if (delta > 0) clock.advance(delta);
}

/** Stand up a fresh billing instance with a known clock + provider. */
function harness(overrides: TestBillingOverrides = {}) {
  const clock = overrides.clock ?? new FixedClock(START);
  const { billing, storage, provider } = createTestBilling({ clock, ...overrides });
  return { billing, storage, provider, clock };
}

/** Full mandate registration so a subscription can be created. */
async function registerMandate(
  billing: ReturnType<typeof createTestBilling>["billing"],
  externalId = "cust_ext_1",
  method: "upi" | "card" | "emandate" = "upi"
) {
  await billing.customers.ensure({ id: externalId, email: "u@example.com", name: "User", contact: "9999999999" });
  const auth = await billing.mandates.createAuthorization({
    customer: { id: externalId, email: "u@example.com", name: "User", contact: "9999999999" },
    method,
    amount: 100,
    mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
  });
  const verified = await billing.mandates.verifyAuthorizationCallback({
    provider: "razorpay",
    authorizationId: auth.authorizationId,
    response: { razorpay_payment_id: "pay_abc", razorpay_order_id: auth.providerOrderId, razorpay_signature: "sig" }
  });
  return { auth, verified };
}

describe("lifecycle: signup -> mandate -> subscription", () => {
  it("captures the initial invoice and activates the subscription", async () => {
    const { billing } = harness();
    const { verified } = await registerMandate(billing);

    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    expect(created.charge?.status).toBe("captured");
    expect(created.invoiceId).toBeTruthy();

    const sub = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(sub.status).toBe("active");
    expect(sub.planId).toBe("starter_monthly_inr");

    const invoice = (await billing.invoices.get(created.invoiceId!))!;
    expect(invoice.status).toBe("paid");
    expect(invoice.total).toBe(50000);
    expect(invoice.reason).toBe("initial");

    // Entitlement reflects active paid access.
    const access = await billing.entitlement.getAccessForCustomer("cust_ext_1");
    expect(access.hasAccess).toBe(true);
    expect(access.subscriptionId).toBe(sub.id);
  });

  it("reuses an existing customer (idempotent customers.ensure)", async () => {
    const { billing } = harness();
    const a = await billing.customers.ensure({ id: "cust_ext_1", email: "a@example.com", name: "A", contact: null });
    const b = await billing.customers.ensure({ id: "cust_ext_1", email: "a@example.com", name: "A", contact: null });
    expect(b.id).toBe(a.id);
  });

  it("reuses the stored Razorpay customer across repeat mandate authorizations", async () => {
    const provider = new FakeProvider();
    const { billing, storage } = harness({ provider });
    await billing.customers.ensure({ id: "cust_ext_1", email: "u@example.com", name: "User", contact: "9999999999" });

    const first = await billing.mandates.createAuthorization({
      customer: { id: "cust_ext_1", email: "u@example.com", name: "User", contact: "9999999999" },
      method: "upi",
      amount: 100,
      mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
    });
    const second = await billing.mandates.createAuthorization({
      customer: { id: "cust_ext_1", email: "u@example.com", name: "User", contact: "9999999999" },
      method: "card",
      amount: 100,
      mandate: { maxAmount: 1_000_000, frequency: "as_presented", expiresAt: null }
    });

    expect(second.providerCustomerId).toBe(first.providerCustomerId);
    expect(provider.customerInputs[0]?.providerCustomerId).toBeNull();
    expect(provider.customerInputs[1]?.providerCustomerId).toBe(first.providerCustomerId);
    const customer = await storage.getCustomerByExternalId("cust_ext_1");
    expect(await storage.listProviderCustomers(customer!.id)).toHaveLength(1);
  });
});

describe("lifecycle: renewal", () => {
  it("creates a new paid renewal invoice and advances the billing period", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });
    const subBefore = (await billing.subscriptions.get(created.subscriptionId))!;
    const previousNextBilling = subBefore.nextBillingAt!;

    // Advance past the actual next billing date (calendar month).
    advancePastRenewal(clock, previousNextBilling);

    const [item] = await billing.renewals.runRenewals({ before: clock.now() });
    expect(item).toBeTruthy();
    expect(item!.result.status).toBe("captured");

    const subAfter = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(subAfter.status).toBe("active");
    // Period advanced: nextBillingAt moved forward by one interval.
    expect(subAfter.nextBillingAt!.getTime()).toBeGreaterThan(previousNextBilling.getTime());
    expect(subAfter.currentPeriodStart.getTime()).toBe(previousNextBilling.getTime());

    // A new renewal invoice exists and is paid.
    const invoices = await billing.invoices.listBySubscription(created.subscriptionId);
    const renewals = invoices.filter((i) => i.reason === "renewal");
    expect(renewals).toHaveLength(1);
    expect(renewals[0]!.status).toBe("paid");
  });

  it("is idempotent: replaying the same cycle key returns the same outcome with no extra invoice/charge", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });
    const sub = (await billing.subscriptions.get(created.subscriptionId))!;

    advancePastRenewal(clock, sub.nextBillingAt!);

    const first = await billing.renewals.chargeDueSubscription({
      subscriptionId: created.subscriptionId,
      idempotencyKey: `renewal:${sub.id}:${sub.nextBillingAt!.toISOString().slice(0, 7)}`
    });
    expect(first.status).toBe("captured");

    const invoicesAfterFirst = await billing.invoices.listBySubscription(created.subscriptionId);

    // Replay the same cycle key.
    const replayed = await billing.renewals.chargeDueSubscription({
      subscriptionId: created.subscriptionId,
      idempotencyKey: `renewal:${sub.id}:${sub.nextBillingAt!.toISOString().slice(0, 7)}`
    });
    expect(replayed.status).toBe("captured");

    const invoicesAfterReplay = await billing.invoices.listBySubscription(created.subscriptionId);
    // No new invoice was created by the replay.
    expect(invoicesAfterReplay.length).toBe(invoicesAfterFirst.length);
  });
});


  it("prevents multiple active subscriptions for the same customer", async () => {
    const { billing } = harness();
    const { verified } = await registerMandate(billing);

    await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    await expect(
      billing.subscriptions.create({
        customerId: "cust_ext_1",
        mandateId: verified.mandateId,
        planId: "pro_monthly_inr",
        idempotencyKey: "initial:2"
      })
    ).rejects.toThrow(/already has an active subscription/i);
  });

describe("lifecycle: upgrade / downgrade", () => {
  it("immediate upgrade: preview -> confirm captures the proration and changes planId", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    // Advance ~halfway through the period so proration is non-trivial.
    clock.advance(15 * 24 * 60 * 60 * 1000);

    const preview = await billing.planChanges.preview({
      subscriptionId: created.subscriptionId,
      targetPlanId: "pro_monthly_inr",
      timing: "immediate"
    });
    expect(preview.timing).toBe("immediate");
    expect(preview.amountDue).toBeGreaterThan(0);
    expect(preview.lines.some((l) => l.type === "proration" && l.amount < 0)).toBe(true); // credit
    expect(preview.lines.some((l) => l.type === "proration" && l.amount > 0)).toBe(true); // debit
    expect(preview.exceedsMandateCap).toBe(false); // mandate max is 1_000_000

    const confirmed = await billing.planChanges.confirm({
      subscriptionId: created.subscriptionId,
      previewId: preview.id,
      idempotencyKey: "upgrade:1"
    });
    expect(confirmed.status).toBe("captured");

    const sub = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(sub.planId).toBe("pro_monthly_inr");
    expect(sub.status).toBe("active");

    // The upgrade invoice total equals the preview amountDue.
    const upgradeInvoice = (await billing.invoices.listBySubscription(created.subscriptionId)).find(
      (i) => i.reason === "upgrade"
    )!;
    expect(upgradeInvoice.total).toBe(preview.amountDue);
  });

  it("rejects a tampered plan-change preview token", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });
    clock.advance(15 * 24 * 60 * 60 * 1000);

    const preview = await billing.planChanges.preview({
      subscriptionId: created.subscriptionId,
      targetPlanId: "pro_monthly_inr",
      timing: "immediate"
    });
    const [payload, signature] = preview.id.split(".");
    const token = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as { targetPlanId: string };
    token.targetPlanId = "team_monthly_inr";
    const tampered = `${Buffer.from(JSON.stringify(token), "utf8").toString("base64url")}.${signature}`;

    await expect(
      billing.planChanges.confirm({
        subscriptionId: created.subscriptionId,
        previewId: tampered,
        idempotencyKey: "upgrade:tampered"
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("immediate downgrade is rejected (must use period_end)", async () => {
    const { billing } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "pro_monthly_inr",
      idempotencyKey: "initial:1"
    });
    await expect(
      billing.planChanges.preview({
        subscriptionId: created.subscriptionId,
        targetPlanId: "starter_monthly_inr",
        timing: "immediate"
      })
    ).rejects.toThrow(/period_end|downgrade/i);
  });

  it("period_end downgrade: schedules, sets pendingPlanId, applies at next renewal", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "pro_monthly_inr",
      idempotencyKey: "initial:1"
    });

    const preview = await billing.planChanges.preview({
      subscriptionId: created.subscriptionId,
      targetPlanId: "starter_monthly_inr",
      timing: "period_end"
    });
    expect(preview.amountDue).toBe(0); // nothing due now

    const confirmed = await billing.planChanges.confirm({
      subscriptionId: created.subscriptionId,
      previewId: preview.id,
      idempotencyKey: "downgrade:1"
    });
    expect(confirmed.status).toBe("scheduled");

    const scheduled = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(scheduled.planId).toBe("pro_monthly_inr"); // still on old plan
    expect(scheduled.pendingPlanId).toBe("starter_monthly_inr");

    // Run the renewal; the downgrade should mature.
    const scheduled2 = (await billing.subscriptions.get(created.subscriptionId))!;
    advancePastRenewal(clock, scheduled2.nextBillingAt ?? scheduled2.currentPeriodEnd);
    const [renewal] = await billing.renewals.runRenewals({ before: clock.now() });
    expect(renewal!.result.status).toBe("captured");

    const after = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(after.planId).toBe("starter_monthly_inr");
    expect(after.pendingPlanId).toBeNull();
  });
});

describe("lifecycle: mandate cap exceeded on upgrade", () => {
  it("returns reauthorization_required and does not charge when upgrade exceeds the mandate cap", async () => {
    // Build a provider/mandate whose reported maxAmount is low.
    const provider = new FakeProvider();
    const { billing } = harness({ provider });
    const { verified } = await registerMandate(billing);

    // Force the stored mandate maxAmount below the upgrade proration debit.
    const mandate = (await billing.mandates.get(verified.mandateId))!;
    await billing.ctx.storage.updateMandate(mandate.id, { maxAmount: 60000 });

    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    const preview = await billing.planChanges.preview({
      subscriptionId: created.subscriptionId,
      targetPlanId: "team_monthly_inr", // 500000 -> well above the 60000 cap
      timing: "immediate"
    });
    expect(preview.exceedsMandateCap).toBe(true);

    const confirmed = await billing.planChanges.confirm({
      subscriptionId: created.subscriptionId,
      previewId: preview.id,
      idempotencyKey: "upgrade:1"
    });
    expect(confirmed.status).toBe("reauthorization_required");

    // No upgrade invoice was created (the only invoice is the initial one).
    const invoices = await billing.invoices.listBySubscription(created.subscriptionId);
    expect(invoices.filter((i) => i.reason === "upgrade")).toHaveLength(0);
  });
});

describe("lifecycle: cancellation", () => {
  it("period_end cancellation sets cancel_at_period_end and keeps access", async () => {
    const { billing } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    const canceled = await billing.subscriptions.cancel({
      subscriptionId: created.subscriptionId,
      timing: "period_end",
      reason: "user_requested"
    });
    expect(canceled.status).toBe("cancel_at_period_end");
    expect(canceled.cancelAtPeriodEnd).toBe(true);

    const access = await billing.entitlement.getAccessForSubscription(created.subscriptionId);
    expect(access.hasAccess).toBe(true); // still within the period
    expect(access.reason).toBe("cancel_at_period_end");
  });

  it("immediate cancellation moves to canceled and ends access immediately", async () => {
    const { billing, clock } = harness();
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    const now = clock.now();
    const canceled = await billing.subscriptions.cancel({
      subscriptionId: created.subscriptionId,
      timing: "immediate",
      reason: "user_requested"
    });
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceledAt?.getTime()).toBe(now.getTime());
    // accessEndsAt was snapped to now -> access revoked immediately.
    expect(canceled.accessEndsAt.getTime()).toBe(now.getTime());
    // Advance just past the canceled accessEndsAt so the entitlement read agrees
    // access has ended (the policy grants access while now <= accessEndsAt).
    clock.advance(1);
    const access = await billing.entitlement.getAccessForSubscription(created.subscriptionId);
    expect(access.hasAccess).toBe(false);
  });
});

describe("lifecycle: dunning (failed_retryable -> retry -> capture)", () => {
  it("marks the subscription past_due and retries successfully on the next attempt", async () => {
    // Start capturing so the initial charge succeeds and the sub is active.
    const provider = new FakeProvider({ nextPaymentState: "captured" });
    const { billing, clock, storage } = harness({ provider });
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });
    expect(((await billing.subscriptions.get(created.subscriptionId))!).status).toBe("active");

    // Trigger a renewal that fails as retryable.
    provider.behavior.nextPaymentState = "failed";
    provider.behavior.nextFailureCode = "INSUFFICIENT_FUNDS";
    const sub0 = (await billing.subscriptions.get(created.subscriptionId))!;
    advancePastRenewal(clock, sub0.nextBillingAt!);
    const [renewal] = await billing.renewals.runRenewals({ before: clock.now() });
    expect(renewal!.result.status).toBe("failed_retryable");

    const subPastDue = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(subPastDue.status).toBe("past_due");

    // The failed attempt scheduled a retry per retryScheduleMs[0] = 60s.
    const attempts = await storage.listChargeAttemptsBySubscription(created.subscriptionId);
    const failed = attempts.find((a) => a.status === "failed_retryable")!;
    expect(failed.nextRetryAt).not.toBeNull();
    expect(failed.failureCode).toBe("INSUFFICIENT_FUNDS");

    // Advance past the retry time and flip the provider back to capturing.
    provider.behavior.nextPaymentState = "captured";
    clock.advance(120_000); // > 60s
    const retried = await billing.scheduler.runRetries({ before: clock.now() });
    expect(retried).toHaveLength(1);
    expect(retried[0]!.result.status).toBe("captured");

    const subRecovered = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(subRecovered.status).toBe("active");
  });
});

describe("lifecycle: UPI async (pending -> captured via reconcile)", () => {
  it("marks the subscription payment_pending, then reconcile captures it", async () => {
    // Start capturing so setup succeeds; flip to pending for the renewal debit.
    const provider = new FakeProvider({ nextPaymentState: "captured", asyncCapture: true });
    const { billing, clock } = harness({ provider });
    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });
    expect(((await billing.subscriptions.get(created.subscriptionId))!).status).toBe("active");

    provider.behavior.nextPaymentState = "pending";
    provider.behavior.asyncCapture = true;
    const sub0 = (await billing.subscriptions.get(created.subscriptionId))!;
    advancePastRenewal(clock, sub0.nextBillingAt!);
    const [renewal] = await billing.renewals.runRenewals({ before: clock.now() });
    expect(renewal!.result.status).toBe("pending");

    const subPending = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(subPending.status).toBe("payment_pending");

    // Entitlement during pending grace window still grants access.
    const access = await billing.entitlement.getAccessForSubscription(created.subscriptionId);
    expect(access.hasAccess).toBe(true);

    // Reconcile polls the provider; FakeProvider asyncCapture flips it to captured.
    const [reconciled] = await billing.scheduler.reconcilePendingPayments();
    expect(reconciled!.resolvedTo).toBe("captured");

    const subCaptured = (await billing.subscriptions.get(created.subscriptionId))!;
    expect(subCaptured.status).toBe("active");
    const renewalInvoice = (await billing.invoices.listBySubscription(created.subscriptionId)).find(
      (i) => i.reason === "renewal"
    )!;
    expect(renewalInvoice.status).toBe("paid");
  });
});

describe("lifecycle: operational hooks + discount", () => {
  it("fires invoice.paid and charge.captured events to a registered hook", async () => {
    const { billing } = harness();
    const events: NormalizedBillingEvent[] = [];
    billing.onOperationalEvent((e) => {
      events.push(e);
    });

    const { verified } = await registerMandate(billing);
    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1"
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("charge.captured");
    expect(types).toContain("invoice.paid");
    // Each event references the invoice/charge we just created.
    const paid = events.find((e) => e.type === "invoice.paid")!;
    expect(paid.invoiceId).toBe(created.invoiceId);
  });

  it("applies a percent discount on the initial invoice, reducing the total", async () => {
    const { billing } = harness();
    const { verified } = await registerMandate(billing);

    // Register a discount the invoice builder can resolve by code.
    await billing.discounts.upsert({
      id: "disc_save10",
      code: "SAVE10",
      type: "percent",
      value: 10,
      duration: "once",
      durationInCycles: null,
      validFrom: null,
      validUntil: null,
      maxRedemptions: null,
      active: true,
      appliesToPlanIds: null,
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0)
    } as never);

    const created = await billing.subscriptions.create({
      customerId: "cust_ext_1",
      mandateId: verified.mandateId,
      planId: "starter_monthly_inr",
      idempotencyKey: "initial:1",
      discountCodes: ["SAVE10"]
    });

    const invoice = (await billing.invoices.get(created.invoiceId!))!;
    expect(invoice.subtotal).toBe(50000);
    expect(invoice.discountTotal).toBe(5000); // 10%
    expect(invoice.total).toBe(45000);
    expect(invoice.status).toBe("paid");
  });
});

// keep imports referenced
void InMemoryBillingStorage;
void sequentialIdFactory;
void defaultTestConfig;
