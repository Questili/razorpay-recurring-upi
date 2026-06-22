/**
 * Renewal namespace. Charges subscriptions whose nextBillingAt has arrived,
 * building a fresh invoice for the upcoming period and running it through the
 * charge engine. Recurring discounts (forever/repeating) attached to the
 * subscription are re-applied each cycle based on prior redemption counts.
 *
 * Idempotency: the idempotency key encodes the subscription + billing cycle, so
 * a repeated scheduler tick for the same cycle returns the original outcome
 * without creating a second invoice or charge.
 */
import type { BillingContext } from "./context.js";
import { requirePlan } from "./context.js";
import { notFound } from "../errors.js";
import { addInterval } from "../domain/renewal-schedule.js";
import { shouldApplyDiscount } from "../domain/discount.js";
import { createInvoiceRecord } from "./invoice-builder.js";
import { chargeInvoice, mapResult } from "./charge-engine.js";
import type { ChargeDueInput, ChargeResult } from "../types/api.js";
import type { BillingSubscription } from "../types/records.js";

export interface RunRenewalsInput {
  before?: Date;
  idempotencyKeyFor?: (subscription: BillingSubscription) => string;
}

export interface RenewalRunItem {
  subscriptionId: string;
  result: ChargeResult;
}

function cycleMarker(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

function defaultIdempotencyKey(sub: BillingSubscription): string {
  const marker = sub.nextBillingAt ? cycleMarker(sub.nextBillingAt) : "due";
  return `renewal:${sub.id}:${marker}`;
}

export function createRenewalsApi(ctx: BillingContext) {
  async function chargeDueSubscription(input: ChargeDueInput): Promise<ChargeResult> {
    // Idempotent replay: same cycle key -> original outcome, no new invoice.
    const existing = await ctx.storage.getChargeAttemptByIdempotencyKey(input.idempotencyKey);
    if (existing) return mapResult(existing);

    const sub = await ctx.storage.getSubscription(input.subscriptionId);
    if (!sub) throw notFound("Subscription", input.subscriptionId);

    if (sub.status !== "active") {
      return { status: "skipped", reason: `subscription_not_active:${sub.status}` };
    }
    if (!sub.nextBillingAt || sub.nextBillingAt.getTime() > ctx.clock.now().getTime()) {
      return { status: "skipped", reason: "not_due" };
    }

    const plan = await requirePlan(ctx, sub.planId);
    const mandate = sub.mandateId ? await ctx.storage.getMandate(sub.mandateId) : undefined;
    if (!mandate) throw notFound("Mandate", sub.mandateId ?? "");

    const priorInvoices = await ctx.storage.listInvoicesBySubscription(sub.id);
    const reason = priorInvoices.length === 0 ? "initial" : "renewal";
    const period = { start: sub.currentPeriodEnd, end: addInterval(sub.currentPeriodEnd, plan.interval) };

    // Re-apply recurring discounts attached to the subscription.
    const attachedCodes = (sub.metadata["attachedDiscountCodes"] as string[] | undefined) ?? [];
    const recurringCodes: string[] = [];
    for (const code of attachedCodes) {
      const discount = await ctx.storage.getDiscountByCode(code);
      if (!discount || !discount.active) continue;
      const priorAppliedCycles = (await ctx.storage.listDiscountRedemptionsForSubscription(discount.id, sub.id)).length;
      if (shouldApplyDiscount(discount, priorAppliedCycles)) {
        recurringCodes.push(code);
      }
    }

    const { invoice } = await createInvoiceRecord(ctx, {
      subscription: sub,
      plan,
      reason,
      period,
      now: ctx.clock.now(),
      discountCodes: recurringCodes.length > 0 ? recurringCodes : null
    });

    return chargeInvoice(ctx, {
      invoice,
      subscription: sub,
      mandate,
      plan,
      idempotencyKey: input.idempotencyKey
    });
  }

  async function chargeInvoiceById(input: { invoiceId: string; idempotencyKey: string }): Promise<ChargeResult> {
    const existing = await ctx.storage.getChargeAttemptByIdempotencyKey(input.idempotencyKey);
    if (existing) return mapResult(existing);
    const invoice = await ctx.storage.getInvoice(input.invoiceId);
    if (!invoice) throw notFound("Invoice", input.invoiceId);
    const sub = await ctx.storage.getSubscription(invoice.subscriptionId);
    const mandate = sub?.mandateId ? await ctx.storage.getMandate(sub.mandateId) : undefined;
    if (!sub || !mandate) throw notFound("Subscription/Mandate for invoice", input.invoiceId);
    const plan = await requirePlan(ctx, sub.planId);
    return chargeInvoice(ctx, { invoice, subscription: sub, mandate, plan, idempotencyKey: input.idempotencyKey });
  }

  async function runRenewals(input: RunRenewalsInput = {}): Promise<RenewalRunItem[]> {
    const before = input.before ?? ctx.clock.now();
    const due = await ctx.storage.listSubscriptionsDueForRenewal(before);
    const keyFor = input.idempotencyKeyFor ?? defaultIdempotencyKey;
    const out: RenewalRunItem[] = [];
    for (const sub of due) {
      const result = await chargeDueSubscription({ subscriptionId: sub.id, idempotencyKey: keyFor(sub) });
      out.push({ subscriptionId: sub.id, result });
    }
    return out;
  }

  return { chargeDueSubscription, chargeInvoiceById, runRenewals };
}
