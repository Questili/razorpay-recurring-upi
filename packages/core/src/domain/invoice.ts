/**
 * Invoice builder. Turns a plan + reason + (optional proration / discounts) into
 * a deterministic set of line items with reconciled subtotal / discount / total.
 *
 * Line rules:
 *  - initial / renewal: a single positive `plan` line for the full period.
 *  - upgrade (immediate): a negative `proration` credit for unused old-plan time
 *    and a positive `proration` debit for remaining new-plan time.
 *  - manual_adjustment: caller-supplied adjustment lines.
 *
 * Discounts are appended as negative `discount` lines. taxTotal is 0 in v1 (the
 * kit makes no tax claims). All money integer subunits.
 */
import type { BillingDiscount } from "../types/records.js";
import type { BillingPlan } from "../types/config.js";
import type { InvoiceLineType, InvoiceReason } from "../types/enums.js";
import type { Period } from "./renewal-schedule.js";
import { computeProration } from "./proration.js";
import { discountAmount, shouldApplyDiscount } from "./discount.js";
import { sumSigned } from "./money.js";

export interface DraftInvoiceLine {
  type: InvoiceLineType;
  description: string;
  quantity: number;
  unitAmount: number;
  /** Signed subunits. Negative for credits and discounts. */
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  metadata: Record<string, unknown>;
}

export interface DraftAdjustmentLine {
  description: string;
  /** Signed subunits. */
  amount: number;
}

export interface InvoiceBuildInput {
  plan: BillingPlan;
  reason: InvoiceReason;
  period: Period;
  now: Date;
  /** For immediate upgrades: the old plan amount being replaced. */
  upgradeFromAmount?: number | null;
  /** Applicable discounts with their prior per-subscription cycle count. */
  discounts?: ReadonlyArray<{ discount: BillingDiscount; priorAppliedCycles: number }> | null;
  /** Caller-supplied adjustment lines (manual_adjustment reason). */
  adjustments?: ReadonlyArray<DraftAdjustmentLine> | null;
}

export interface DraftInvoice {
  reason: InvoiceReason;
  currency: BillingPlan["currency"];
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  lines: DraftInvoiceLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export function buildInvoice(input: InvoiceBuildInput): DraftInvoice {
  const { plan, reason, period, now } = input;
  const lines: DraftInvoiceLine[] = [];

  if (reason === "upgrade" && typeof input.upgradeFromAmount === "number") {
    const proration = computeProration({
      periodStart: period.start,
      periodEnd: period.end,
      now,
      oldAmount: input.upgradeFromAmount,
      newAmount: plan.amount
    });
    if (proration.credit > 0) {
      lines.push({
        type: "proration",
        description: `Credit: unused time on previous plan`,
        quantity: 1,
        unitAmount: -proration.credit,
        amount: -proration.credit,
        periodStart: now,
        periodEnd: period.end,
        metadata: { proration: "credit", fraction: proration.fraction }
      });
    }
    lines.push({
      type: "proration",
      description: `Prorated charge: ${plan.name} (remainder of period)`,
      quantity: 1,
      unitAmount: proration.debit,
      amount: proration.debit,
      periodStart: now,
      periodEnd: period.end,
      metadata: { proration: "debit", fraction: proration.fraction }
    });
  } else if (reason === "manual_adjustment" && input.adjustments && input.adjustments.length > 0) {
    for (const adj of input.adjustments) {
      lines.push({
        type: "adjustment",
        description: adj.description,
        quantity: 1,
        unitAmount: adj.amount,
        amount: adj.amount,
        periodStart: period.start,
        periodEnd: period.end,
        metadata: {}
      });
    }
  } else {
    lines.push({
      type: "plan",
      description: `${plan.name} (${plan.interval})`,
      quantity: 1,
      unitAmount: plan.amount,
      amount: plan.amount,
      periodStart: period.start,
      periodEnd: period.end,
      metadata: {}
    });
  }

  let subtotal = sumSigned(lines.map((l) => l.amount));

  // Apply discounts against the running subtotal.
  let discountTotal = 0;
  if (input.discounts && input.discounts.length > 0) {
    for (const { discount, priorAppliedCycles } of input.discounts) {
      if (!shouldApplyDiscount(discount, priorAppliedCycles)) continue;
      const applicableOn = Math.max(0, subtotal - discountTotal);
      const amt = discountAmount(discount, applicableOn);
      if (amt <= 0) continue;
      discountTotal += amt;
      lines.push({
        type: "discount",
        description: `Discount: ${discount.code} (${discount.type})`,
        quantity: 1,
        unitAmount: -amt,
        amount: -amt,
        periodStart: period.start,
        periodEnd: period.end,
        metadata: { discountId: discount.id, discountCode: discount.code }
      });
    }
  }

  const taxTotal = 0;
  const total = subtotal - discountTotal + taxTotal;

  return {
    reason,
    currency: plan.currency,
    periodStart: new Date(period.start.getTime()),
    periodEnd: new Date(period.end.getTime()),
    dueAt: new Date(now.getTime()),
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    total
  };
}

/** The amount that must actually move through the provider. Negative => 0 charge. */
export function chargeableAmount(total: number): number {
  return Math.max(0, total);
}
