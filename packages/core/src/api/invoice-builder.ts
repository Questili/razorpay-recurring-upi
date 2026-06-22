/**
 * Internal invoice materializer. Resolves + validates discount codes, builds the
 * line items via the domain engine, persists the invoice + lines, and stamps the
 * applied discount ids onto invoice metadata so the charge engine can record
 * redemptions on capture. Shared by initial / renewal / upgrade flows.
 */
import type { BillingContext } from "./context.js";
import { buildInvoice, type DraftAdjustmentLine } from "../domain/invoice.js";
import type { Period } from "../domain/renewal-schedule.js";
import { shouldApplyDiscount, validateDiscountCode } from "../domain/discount.js";
import type { InvoiceReason } from "../types/enums.js";
import type { BillingPlan } from "../types/config.js";
import type { BillingInvoice, BillingInvoiceLine, BillingSubscription } from "../types/records.js";

export interface CreateInvoiceRecordInput {
  subscription: BillingSubscription;
  plan: BillingPlan;
  reason: InvoiceReason;
  period: Period;
  now: Date;
  upgradeFromAmount?: number | null;
  discountCodes?: string[] | null;
  adjustments?: ReadonlyArray<DraftAdjustmentLine> | null;
  metadata?: Record<string, unknown>;
}

export interface CreatedInvoice {
  invoice: BillingInvoice;
  lines: BillingInvoiceLine[];
}

export async function createInvoiceRecord(ctx: BillingContext, input: CreateInvoiceRecordInput): Promise<CreatedInvoice> {
  const { subscription, plan, reason, period, now } = input;

  // Resolve discounts: validate each code, then include only those that apply
  // to the current cycle given prior redemptions on this subscription.
  type ResolvedDiscount = { discount: import("../types/records.js").BillingDiscount; priorAppliedCycles: number };
  const applicableDiscounts: ResolvedDiscount[] = [];
  const codes = input.discountCodes ?? [];
  for (const code of codes) {
    const discount = await ctx.storage.getDiscountByCode(code);
    if (!discount) {
      ctx.logger.warn("discount code not found during invoicing", { code });
      continue;
    }
    const redemptionCount = await ctx.storage.countDiscountRedemptions(discount.id);
    const validation = validateDiscountCode(
      discount,
      { code, customerId: subscription.billingCustomerId, planId: plan.id, now },
      redemptionCount
    );
    if (!validation.valid) {
      ctx.logger.warn("discount code rejected during invoicing", { code, reason: validation.reason });
      continue;
    }
    const priorAppliedCycles = (
      await ctx.storage.listDiscountRedemptionsForSubscription(discount.id, subscription.id)
    ).length;
    applicableDiscounts.push({ discount, priorAppliedCycles });
  }

  const draft = buildInvoice({
    plan,
    reason,
    period,
    now,
    upgradeFromAmount: input.upgradeFromAmount ?? null,
    discounts: applicableDiscounts.map((d) => ({ discount: d.discount, priorAppliedCycles: d.priorAppliedCycles })),
    adjustments: input.adjustments
  });

  // Determine which discounts actually produced a line (shouldApplyDiscount may
  // have returned false for exhausted once/repeating durations).
  const appliedDiscountIds = applicableDiscounts
    .filter((d) => shouldApplyDiscount(d.discount, d.priorAppliedCycles))
    .map((d) => d.discount.id);

  const invoice = await ctx.storage.createInvoice({
    subscriptionId: subscription.id,
    customerId: subscription.billingCustomerId,
    status: "open",
    reason,
    currency: draft.currency,
    subtotal: draft.subtotal,
    discountTotal: draft.discountTotal,
    taxTotal: draft.taxTotal,
    total: draft.total,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    dueAt: draft.dueAt,
    paidAt: null,
    metadata: { ...(input.metadata ?? {}), appliedDiscountIds }
  });

  const lines = await ctx.storage.createInvoiceLines(
    draft.lines.map((l) => ({
      invoiceId: invoice.id,
      type: l.type,
      description: l.description,
      quantity: l.quantity,
      unitAmount: l.unitAmount,
      amount: l.amount,
      periodStart: l.periodStart,
      periodEnd: l.periodEnd,
      metadata: l.metadata
    }))
  );

  return { invoice, lines };
}
