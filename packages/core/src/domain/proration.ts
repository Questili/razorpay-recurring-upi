/**
 * Proration. On an immediate mid-cycle upgrade we credit the unused portion of
 * the old plan for the remainder of the current period and debit the new plan
 * for that same remainder. The net difference is what the upgrade invoice charges.
 *
 * All math is integer-subunit and rounds to the nearest paise. We compute debit
 * and credit independently (rather than netting first) so the invoice shows both
 * lines for auditability and refunds reconcile.
 */
import { allocate, assertSubunits } from "./money.js";
import { remainingFraction } from "./renewal-schedule.js";

export interface ProrationInput {
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  oldAmount: number;
  newAmount: number;
}

export interface ProrationResult {
  /** Credit for unused time on the old plan (subunits, always >= 0). */
  credit: number;
  /** Charge for remaining time on the new plan (subunits, always >= 0). */
  debit: number;
  /** Net payable for the remainder. May be negative (net credit). */
  net: number;
  fraction: number;
}

export function computeProration(input: ProrationInput): ProrationResult {
  assertSubunits(input.oldAmount, "oldAmount");
  assertSubunits(input.newAmount, "newAmount");
  const fraction = remainingFraction(input.periodStart, input.periodEnd, input.now);
  // allocate() = roundPaise(amount * numerator / denominator). We pass 1/1 scaled by fraction
  // via the integer-preserving allocate by scaling fraction to a large denominator.
  const SCALE = 1_000_000;
  const numerator = Math.round(fraction * SCALE);
  const credit = allocate(input.oldAmount, numerator, SCALE);
  const debit = allocate(input.newAmount, numerator, SCALE);
  return { credit, debit, net: debit - credit, fraction };
}
