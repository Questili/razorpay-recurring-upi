/**
 * Scheduler / dunning namespace. Deterministic job primitives a host app drives
 * from cron/queue infrastructure. The kit never owns a timer; it exposes:
 *
 *  - runRenewals: charge subscriptions whose nextBillingAt has arrived.
 *  - runRetries: re-attempt failed_retryable charges whose nextRetryAt arrived.
 *  - reconcilePendingPayments: poll provider status for unresolved UPI debits.
 *  - runReconciliation: finalize cancel_at_period_end and expire lapsed subs.
 *  - runAll: convenience that runs the full maintenance loop once.
 *
 * Each job returns a structured summary suitable for logging/alerting.
 */
import type { BillingContext } from "./context.js";
import { emit, requirePlan } from "./context.js";
import { chargeInvoice, applyProviderOutcome } from "./charge-engine.js";
import { subscriptionMachine } from "../domain/state-machine.js";
import { DAY_MS } from "../domain/renewal-schedule.js";
import type { ChargeResult } from "../types/api.js";

export interface RetryRunItem {
  chargeAttemptId: string;
  invoiceId: string;
  result: ChargeResult;
}

export interface ReconcilePendingItem {
  subscriptionId: string;
  chargeAttemptId: string;
  resolvedTo: "captured" | "pending" | "failed" | "error";
}

export interface ReconciliationSummary {
  canceledAtPeriodEnd: number;
  expired: number;
  pendingReconciled: number;
}

export function createSchedulerApi(ctx: BillingContext, renewalsRun: (opts: { before: Date }) => Promise<Array<{ subscriptionId: string; result: ChargeResult }>>) {
  async function runRetries(input: { before?: Date } = {}): Promise<RetryRunItem[]> {
    const before = input.before ?? ctx.clock.now();
    const due = await ctx.storage.listChargeAttemptsToRetry(before);
    const out: RetryRunItem[] = [];
    for (const attempt of due) {
      // Supersede the old attempt so it is not retried again by a later tick.
      await ctx.storage.updateChargeAttempt(attempt.id, { nextRetryAt: null });
      const invoice = await ctx.storage.getInvoice(attempt.invoiceId);
      const subscription = await ctx.storage.getSubscription(attempt.subscriptionId);
      const mandate = await ctx.storage.getMandate(attempt.mandateId);
      if (!invoice || !subscription || !mandate) continue;
      const plan = await requirePlan(ctx, subscription.planId).catch(() => null);
      if (!plan) continue;
      const idempotencyKey = `retry:${invoice.id}:${attempt.attemptNumber + 1}`;
      const result = await chargeInvoice(ctx, { invoice, subscription, mandate, plan, idempotencyKey });
      out.push({ chargeAttemptId: attempt.id, invoiceId: invoice.id, result });
    }
    return out;
  }

  async function reconcilePendingPayments(input: { before?: Date } = {}): Promise<ReconcilePendingItem[]> {
    const before = input.before ?? ctx.clock.now();
    const subs = await ctx.storage.listSubscriptionsPaymentPending();
    const out: ReconcilePendingItem[] = [];
    for (const sub of subs) {
      const attempts = await ctx.storage.listChargeAttemptsBySubscription(sub.id);
      const pending = attempts.find((a) => a.status === "pending");
      if (!pending || !pending.providerPaymentId) continue;
      const provider = ctx.providers[sub.mandateId ? (await ctx.storage.getMandate(sub.mandateId))?.provider ?? "razorpay" : "razorpay"];
      if (!provider) continue;
      try {
        const status = await provider.fetchPaymentStatus(pending.providerPaymentId);
        let resolvedTo: ReconcilePendingItem["resolvedTo"] = "pending";
        if (status.state === "captured") {
          await applyProviderOutcome(ctx, { chargeAttemptId: pending.id, state: "captured", providerPaymentId: pending.providerPaymentId });
          resolvedTo = "captured";
        } else if (status.state === "failed") {
          await applyProviderOutcome(ctx, { chargeAttemptId: pending.id, state: "failed", providerPaymentId: pending.providerPaymentId, failure: status.failure });
          resolvedTo = "failed";
        }
        out.push({ subscriptionId: sub.id, chargeAttemptId: pending.id, resolvedTo });
      } catch (err) {
        ctx.logger.warn("pending payment reconcile failed", { subscriptionId: sub.id, error: String(err) });
        out.push({ subscriptionId: sub.id, chargeAttemptId: pending.id, resolvedTo: "error" });
      }
    }
    void before;
    return out;
  }

  async function runReconciliation(input: { now?: Date } = {}): Promise<ReconciliationSummary> {
    const now = input.now ?? ctx.clock.now();
    const summary: ReconciliationSummary = { canceledAtPeriodEnd: 0, expired: 0, pendingReconciled: 0 };

    const graceMs = ctx.config.gracePeriodDays * DAY_MS;

    // Finalize cancel_at_period_end subscriptions whose period has ended.
    const cancelAtEnd = await ctx.storage.listSubscriptionsByStatus("cancel_at_period_end");
    for (const sub of cancelAtEnd) {
      if (sub.accessEndsAt.getTime() <= now.getTime()) {
        await ctx.storage.updateSubscription(sub.id, { status: "canceled", canceledAt: now });
        await emit(ctx, { type: "subscription.canceled", subscriptionId: sub.id, at: now });
        summary.canceledAtPeriodEnd++;
      }
    }

    // Expire active subscriptions that lapsed well past access + grace.
    const active = await ctx.storage.listSubscriptionsByStatus("active");
    for (const sub of active) {
      if (sub.accessEndsAt.getTime() + graceMs < now.getTime()) {
        subscriptionMachine.assertTransition("active", "expired");
        await ctx.storage.updateSubscription(sub.id, { status: "expired" });
        summary.expired++;
      }
    }

    summary.pendingReconciled = (await reconcilePendingPayments({ before: now })).filter((r) => r.resolvedTo !== "pending").length;
    return summary;
  }

  async function runAll(input: { now?: Date; before?: Date } = {}): Promise<{
    renewals: Array<{ subscriptionId: string; result: ChargeResult }>;
    retries: RetryRunItem[];
    reconciliation: ReconciliationSummary;
  }> {
    const renewals = await renewalsRun({ before: input.before ?? input.now ?? ctx.clock.now() });
    const retries = await runRetries({ before: input.before ?? input.now });
    const reconciliation = await runReconciliation({ now: input.now });
    return { renewals, retries, reconciliation };
  }

  return { runRetries, reconcilePendingPayments, runReconciliation, runAll };
}
