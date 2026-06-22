/**
 * Charge engine — the single path that turns an open invoice into a provider
 * payment attempt and reconciles the result back onto the invoice, mandate,
 * subscription, and charge-attempt records. Used by initial, renewal, upgrade,
 * and manual charge flows so money movement is uniform and idempotent.
 *
 * Idempotency: keyed on `idempotencyKey`. Replaying the same key returns the
 * original outcome without re-charging. UPI subsequent debits are never
 * overlapped: a pending attempt blocks new attempts for the same invoice.
 */
import type { BillingContext } from "./context.js";
import { emit } from "./context.js";
import type { ChargeResult } from "../types/api.js";
import type { BillingChargeAttempt, BillingInvoice, BillingMandate, BillingSubscription } from "../types/records.js";
import type { BillingPlan } from "../types/config.js";
import type { FailureClass } from "../types/enums.js";
import { chargeableAmount } from "../domain/invoice.js";
import { mandateHealth } from "../domain/mandate.js";
import { classifyFailure, nextRetryAt, DEFAULT_FAILURE_CONFIG } from "../domain/failure.js";
import { invoiceMachine, subscriptionMachine, chargeAttemptMachine } from "../domain/state-machine.js";
import type { ProviderFailureInfo, RecurringPaymentState } from "../providers/types.js";

export interface ChargeInvoiceParams {
  invoice: BillingInvoice;
  subscription: BillingSubscription;
  mandate: BillingMandate;
  plan: BillingPlan;
  idempotencyKey: string;
}

export async function chargeInvoice(ctx: BillingContext, params: ChargeInvoiceParams): Promise<ChargeResult> {
  const { invoice, subscription, mandate, plan, idempotencyKey } = params;
  const now = ctx.clock.now();

  // Idempotent replay: same key -> same outcome, no second provider call.
  const existing = await ctx.storage.getChargeAttemptByIdempotencyKey(idempotencyKey);
  if (existing) {
    return mapAttemptToResult(existing);
  }

  const amount = chargeableAmount(invoice.total);

  // Mandate gate (only when money actually moves).
  if (amount > 0) {
    const health = mandateHealth(mandate, now);
    if (health !== "usable") {
      return await markReauthorization(ctx, {
        invoice,
        subscription,
        mandate,
        idempotencyKey,
        amount,
        reason: health === "paused" ? "mandate_paused" : "mandate_inactive"
      });
    }
    if (amount > mandate.maxAmount) {
      return await markReauthorization(ctx, {
        invoice,
        subscription,
        mandate,
        idempotencyKey,
        amount,
        reason: "mandate_cap_exceeded"
      });
    }
  }

  // No money to move (free trial / 100% discount). Record a zero capture.
  if (amount <= 0) {
    const attempt = await ctx.storage.createChargeAttempt({
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      mandateId: mandate.id,
      provider: mandate.provider,
      providerOrderId: null,
      providerPaymentId: null,
      status: "captured",
      amount: 0,
      currency: invoice.currency,
      failureClass: null,
      failureCode: null,
      failureReason: null,
      nextRetryAt: null,
      attemptNumber: await nextAttemptNumber(ctx, invoice.id),
      idempotencyKey,
      providerRequestRef: null
    });
    await finalizeCaptured(ctx, { invoice, subscription, attempt });
    return { status: "captured", invoiceId: invoice.id, chargeAttemptId: attempt.id };
  }

  // Live provider charge.
  const priorAttempts = await ctx.storage.listChargeAttemptsByInvoice(invoice.id);
  const overlapping = priorAttempts.find((a) => a.status === "pending" || a.status === "submitted");
  if (overlapping) {
    // UPI: do not submit overlapping debits for the same token/cycle.
    return {
      status: "pending",
      invoiceId: invoice.id,
      chargeAttemptId: overlapping.id
    };
  }

  const provider = ctx.providers[mandate.provider];
  if (!provider) throw new Error(`Provider ${mandate.provider} not registered`);

  const attempt = await ctx.storage.createChargeAttempt({
    invoiceId: invoice.id,
    subscriptionId: subscription.id,
    mandateId: mandate.id,
    provider: mandate.provider,
    providerOrderId: null,
    providerPaymentId: null,
    status: "submitted",
    amount,
    currency: invoice.currency,
    failureClass: null,
    failureCode: null,
    failureReason: null,
    nextRetryAt: null,
    attemptNumber: priorAttempts.length + 1,
    idempotencyKey,
    providerRequestRef: null
  });

  const order = await provider.createChargeOrder({
    providerCustomerId: mandate.providerCustomerId,
    amount,
    currency: invoice.currency,
    idempotencyKey,
    notes: { invoiceId: invoice.id, subscriptionId: subscription.id, reason: invoice.reason }
  });
  await ctx.storage.updateChargeAttempt(attempt.id, { providerOrderId: order.providerOrderId });

  const recurring = await provider.createRecurringPayment({
    providerCustomerId: mandate.providerCustomerId,
    providerTokenId: mandate.providerTokenId!,
    amount,
    currency: invoice.currency,
    providerOrderId: order.providerOrderId,
    contact: null,
    email: null,
    idempotencyKey,
    notes: { invoiceId: invoice.id, subscriptionId: subscription.id }
  });

  if (recurring.providerPaymentId) {
    await ctx.storage.updateChargeAttempt(attempt.id, { providerPaymentId: recurring.providerPaymentId });
  }

  if (recurring.state === "captured") {
    const refreshed = (await ctx.storage.getChargeAttempt(attempt.id))!;
    await finalizeCaptured(ctx, { invoice, subscription, attempt: refreshed });
    return { status: "captured", invoiceId: invoice.id, chargeAttemptId: attempt.id };
  }

  if (recurring.state === "pending") {
    chargeAttemptMachine.assertTransition("submitted", "pending");
    await ctx.storage.updateChargeAttempt(attempt.id, { status: "pending" });
    if (subscription.status !== "payment_pending") {
      subscriptionMachine.assertTransition(subscription.status, "payment_pending");
      await ctx.storage.updateSubscription(subscription.id, { status: "payment_pending" });
    }
    await emit(ctx, { type: "charge.pending", chargeAttemptId: attempt.id, invoiceId: invoice.id, at: now });
    return { status: "pending", invoiceId: invoice.id, chargeAttemptId: attempt.id };
  }

  // failed
  const failure = recurring.failure ?? {};
  const klass: FailureClass = failure.failureClass ?? classifyFailure(failure, DEFAULT_FAILURE_CONFIG).class;
  await applyFailure(ctx, { invoice, subscription, mandate, attempt, failure, klass });
  const refreshed = (await ctx.storage.getChargeAttempt(attempt.id))!;
  return mapAttemptToResult(refreshed);
}

async function nextAttemptNumber(ctx: BillingContext, invoiceId: string): Promise<number> {
  const list = await ctx.storage.listChargeAttemptsByInvoice(invoiceId);
  return list.length + 1;
}

async function markReauthorization(
  ctx: BillingContext,
  args: {
    invoice: BillingInvoice;
    subscription: BillingSubscription;
    mandate: BillingMandate;
    idempotencyKey: string;
    amount: number;
    reason: string;
  }
): Promise<ChargeResult> {
  const attempt = await ctx.storage.createChargeAttempt({
    invoiceId: args.invoice.id,
    subscriptionId: args.subscription.id,
    mandateId: args.mandate.id,
    provider: args.mandate.provider,
    providerOrderId: null,
    providerPaymentId: null,
    status: "reauthorization_required",
    amount: args.amount,
    currency: args.invoice.currency,
    failureClass: "reauthorization_required",
    failureCode: args.reason,
    failureReason: args.reason,
    nextRetryAt: null,
    attemptNumber: await nextAttemptNumber(ctx, args.invoice.id),
    idempotencyKey: args.idempotencyKey,
    providerRequestRef: null
  });
  if (args.subscription.status !== "reauthorization_required" && args.subscription.status !== "canceled") {
    subscriptionMachine.assertTransition(args.subscription.status, "reauthorization_required");
    await ctx.storage.updateSubscription(args.subscription.id, { status: "reauthorization_required" });
  }
  await emit(ctx, {
    type: "subscription.reauthorization_required",
    subscriptionId: args.subscription.id,
    reason: args.reason,
    at: ctx.clock.now()
  });
  return { status: "reauthorization_required", reason: args.reason, invoiceId: args.invoice.id, chargeAttemptId: attempt.id };
}

async function applyFailure(
  ctx: BillingContext,
  args: {
    invoice: BillingInvoice;
    subscription: BillingSubscription;
    mandate: BillingMandate;
    attempt: BillingChargeAttempt;
    failure: NonNullable<import("../providers/types.js").ProviderFailureInfo>;
    klass: FailureClass;
  }
): Promise<void> {
  const { invoice, subscription, attempt, klass } = args;
  const now = ctx.clock.now();

  if (klass === "reauthorization_required") {
    chargeAttemptMachine.assertTransition(attempt.status, "reauthorization_required");
    await ctx.storage.updateChargeAttempt(attempt.id, {
      status: "reauthorization_required",
      failureClass: klass,
      failureCode: args.failure.providerErrorCode ?? null,
      failureReason: args.failure.providerErrorDescription ?? null,
      nextRetryAt: null
    });
    if (subscription.status !== "reauthorization_required" && subscription.status !== "canceled") {
      subscriptionMachine.assertTransition(subscription.status, "reauthorization_required");
      await ctx.storage.updateSubscription(subscription.id, { status: "reauthorization_required" });
    }
    await emit(ctx, { type: "subscription.reauthorization_required", subscriptionId: subscription.id, reason: args.failure.providerErrorCode ?? "reauthorization_required", at: now });
    await emit(ctx, { type: "invoice.payment_failed", invoiceId: invoice.id, subscriptionId: subscription.id, failureClass: klass, at: now });
    return;
  }

  if (klass === "terminal") {
    chargeAttemptMachine.assertTransition(attempt.status, "failed_terminal");
    await ctx.storage.updateChargeAttempt(attempt.id, {
      status: "failed_terminal",
      failureClass: klass,
      failureCode: args.failure.providerErrorCode ?? null,
      failureReason: args.failure.providerErrorDescription ?? null,
      nextRetryAt: null
    });
    if (subscription.status !== "canceled") {
      subscriptionMachine.assertTransition(subscription.status, "canceled");
      await ctx.storage.updateSubscription(subscription.id, {
        status: "canceled",
        canceledAt: now,
        cancelReason: "payment_failed_terminal"
      });
    }
    await emit(ctx, { type: "invoice.payment_failed", invoiceId: invoice.id, subscriptionId: subscription.id, failureClass: klass, at: now });
    await emit(ctx, { type: "subscription.canceled", subscriptionId: subscription.id, at: now });
    return;
  }

  // retryable or support_required -> dunning
  const attemptNumber = attempt.attemptNumber;
  const retry = klass === "retryable" ? nextRetryAt(attemptNumber, ctx.config.retryScheduleMs, now) : null;
  chargeAttemptMachine.assertTransition(attempt.status, "failed_retryable");
  await ctx.storage.updateChargeAttempt(attempt.id, {
    status: "failed_retryable",
    failureClass: klass,
    failureCode: args.failure.providerErrorCode ?? null,
    failureReason: args.failure.providerErrorDescription ?? null,
    nextRetryAt: retry
  });
  if (subscription.status !== "past_due" && subscription.status !== "canceled") {
    subscriptionMachine.assertTransition(subscription.status, "past_due");
    await ctx.storage.updateSubscription(subscription.id, { status: "past_due" });
  }
  await emit(ctx, { type: "subscription.past_due", subscriptionId: subscription.id, at: now });
  await emit(ctx, { type: "invoice.payment_failed", invoiceId: invoice.id, subscriptionId: subscription.id, failureClass: klass, at: now });
}

/**
 * Finalize a captured payment: mark invoice paid, advance subscription period
 * for renewals, apply pending plan / upgrade target, and record discount
 * redemptions. Idempotent — safe to call again from webhook reconciliation.
 */
export async function finalizeCaptured(
  ctx: BillingContext,
  args: { invoice: BillingInvoice; subscription: BillingSubscription; attempt: BillingChargeAttempt }
): Promise<void> {
  const { invoice, subscription, attempt } = args;
  const now = ctx.clock.now();

  const current = await ctx.storage.getInvoice(invoice.id);
  if (current && current.status === "paid") return; // idempotent

  // A captured payment is provider ground truth; record it directly.
  if (attempt.status !== "captured") {
    await ctx.storage.updateChargeAttempt(attempt.id, { status: "captured" });
  }
  invoiceMachine.assertTransition(current?.status ?? invoice.status, "paid");
  await ctx.storage.updateInvoice(invoice.id, { status: "paid", paidAt: now });

  const patch: Partial<BillingSubscription> = {};
  if (invoice.reason === "renewal") {
    patch.currentPeriodStart = invoice.periodStart;
    patch.currentPeriodEnd = invoice.periodEnd;
    patch.accessEndsAt = invoice.periodEnd;
    patch.nextBillingAt = invoice.periodEnd;
    // Apply a pending downgrade that matures at this renewal.
    if (subscription.pendingPlanId && subscription.pendingPlanEffectiveAt && subscription.pendingPlanEffectiveAt.getTime() <= now.getTime()) {
      patch.planId = subscription.pendingPlanId;
      patch.pendingPlanId = null;
      patch.pendingPlanEffectiveAt = null;
    }
    patch.status = subscription.status === "cancel_at_period_end" ? "cancel_at_period_end" : "active";
  } else if (invoice.reason === "upgrade") {
    const targetPlanId = (invoice.metadata["targetPlanId"] as string | undefined) ?? subscription.planId;
    patch.planId = targetPlanId;
    patch.pendingPlanId = null;
    patch.pendingPlanEffectiveAt = null;
    patch.status = "active";
  } else {
    patch.status = "active";
  }

  const wasActive = subscription.status === "active";
  await ctx.storage.updateSubscription(subscription.id, patch);

  // Record discount redemptions for discounts applied on this invoice.
  const applied = (invoice.metadata["appliedDiscountIds"] as string[] | undefined) ?? [];
  for (const discountId of applied) {
    await ctx.storage.createDiscountRedemption({
      discountId,
      customerId: subscription.billingCustomerId,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      redeemedAt: now
    });
  }

  await emit(ctx, { type: "charge.captured", chargeAttemptId: args.attempt.id, invoiceId: invoice.id, at: now });
  await emit(ctx, { type: "invoice.paid", invoiceId: invoice.id, subscriptionId: subscription.id, at: now });
  if (invoice.reason === "renewal") {
    await emit(ctx, { type: "subscription.renewed", subscriptionId: subscription.id, at: now });
  } else if (!wasActive && patch.status === "active") {
    await emit(ctx, { type: "subscription.activated", subscriptionId: subscription.id, at: now });
  }
}

/**
 * Apply a provider-reported payment outcome (from a webhook or a scheduler
 * status poll) onto an existing charge attempt. Idempotent: no-ops when the
 * attempt is already in the target or a more authoritative state. Used by the
 * webhook processor and the pending-payment reconciliation job.
 */
export async function applyProviderOutcome(
  ctx: BillingContext,
  args: { chargeAttemptId: string; state: RecurringPaymentState; providerPaymentId?: string | null; failure?: ProviderFailureInfo | null }
): Promise<void> {
  const attempt = await ctx.storage.getChargeAttempt(args.chargeAttemptId);
  if (!attempt) return;
  if (args.providerPaymentId && attempt.providerPaymentId !== args.providerPaymentId) {
    await ctx.storage.updateChargeAttempt(attempt.id, { providerPaymentId: args.providerPaymentId });
  }
  const invoice = await ctx.storage.getInvoice(attempt.invoiceId);
  const subscription = await ctx.storage.getSubscription(attempt.subscriptionId);
  if (!invoice || !subscription) return;

  if (args.state === "captured") {
    await finalizeCaptured(ctx, { invoice, subscription, attempt });
    return;
  }

  if (args.state === "pending") {
    if (attempt.status !== "pending" && attempt.status !== "captured" && chargeAttemptMachine.canTransition(attempt.status, "pending")) {
      await ctx.storage.updateChargeAttempt(attempt.id, { status: "pending" });
    }
    if (subscription.status !== "payment_pending" && subscriptionMachine.canTransition(subscription.status, "payment_pending")) {
      await ctx.storage.updateSubscription(subscription.id, { status: "payment_pending" });
    }
    await emit(ctx, { type: "charge.pending", chargeAttemptId: attempt.id, invoiceId: invoice.id, at: ctx.clock.now() });
    return;
  }

  // failed
  if (attempt.status === "captured" || attempt.status === "failed_terminal") return;
  const mandate = await ctx.storage.getMandate(attempt.mandateId);
  const failure = args.failure ?? {};
  const klass = failure.failureClass ?? classifyFailure(failure, DEFAULT_FAILURE_CONFIG).class;
  await applyFailure(ctx, { invoice, subscription, mandate: mandate!, attempt, failure, klass });
}

/** Public alias so renewal/retry callers can replay an existing attempt idempotently. */
export const mapResult = mapAttemptToResult;

function mapAttemptToResult(attempt: BillingChargeAttempt): ChargeResult {
  const base = { invoiceId: attempt.invoiceId, chargeAttemptId: attempt.id };
  switch (attempt.status) {
    case "captured":
      return { status: "captured", ...base };
    case "pending":
      return { status: "pending", ...base };
    case "failed_retryable":
      return { status: "failed_retryable", ...base, nextRetryAt: attempt.nextRetryAt };
    case "failed_terminal":
      return { status: "failed_terminal", ...base, reason: attempt.failureReason ?? "terminal_failure" };
    case "reauthorization_required":
      return { status: "reauthorization_required", reason: attempt.failureCode ?? "reauthorization_required", invoiceId: attempt.invoiceId, chargeAttemptId: attempt.id };
    case "scheduled":
    case "submitted":
      return { status: "pending", ...base };
  }
}
