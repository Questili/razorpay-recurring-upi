/**
 * Discount engine. Discounts are app-owned (not provider Offers). Codes are
 * validated server-side before invoice creation and their effect is applied as
 * a negative line during invoice calculation. Redemption history is consulted so
 * `once` / `repeating` durations apply the correct number of cycles.
 *
 * Supported: percent, fixed_amount, free_trial × once / repeating / forever.
 */
import type { BillingDiscount, BillingDiscountRedemption } from "../types/records.js";
import { BillingError } from "../errors.js";
import { roundPaise } from "./money.js";

export interface DiscountValidationInput {
  code: string;
  customerId: string;
  planId: string;
  now: Date;
}

export interface DiscountValidationResult {
  valid: boolean;
  reason?: string;
}

/** Validate a discount definition against an attempted redemption. */
export function validateDiscountCode(
  discount: BillingDiscount,
  input: DiscountValidationInput,
  globalRedemptionCount: number
): DiscountValidationResult {
  if (input.code.trim().toLowerCase() !== discount.code.trim().toLowerCase()) {
    return { valid: false, reason: "code_mismatch" };
  }
  if (!discount.active) {
    return { valid: false, reason: "inactive" };
  }
  if (discount.validFrom && input.now.getTime() < discount.validFrom.getTime()) {
    return { valid: false, reason: "not_yet_valid" };
  }
  if (discount.validUntil && input.now.getTime() > discount.validUntil.getTime()) {
    return { valid: false, reason: "expired" };
  }
  if (discount.maxRedemptions !== null && globalRedemptionCount >= discount.maxRedemptions) {
    return { valid: false, reason: "max_redemptions_reached" };
  }
  if (
    discount.appliesToPlanIds !== null &&
    discount.appliesToPlanIds.length > 0 &&
    !discount.appliesToPlanIds.includes(input.planId)
  ) {
    return { valid: false, reason: "plan_not_eligible" };
  }
  if (discount.type === "percent" && (discount.value < 0 || discount.value > 100)) {
    return { valid: false, reason: "invalid_percent_value" };
  }
  if (discount.duration === "repeating" && (!discount.durationInCycles || discount.durationInCycles <= 0)) {
    return { valid: false, reason: "invalid_duration" };
  }
  return { valid: true };
}

/** Whether the discount should apply on the current cycle given prior usage. */
export function shouldApplyDiscount(
  discount: BillingDiscount,
  priorAppliedCycles: number
): boolean {
  switch (discount.duration) {
    case "once":
      return priorAppliedCycles === 0;
    case "repeating":
      return priorAppliedCycles < (discount.durationInCycles ?? 0);
    case "forever":
      return true;
  }
}

/** The discount magnitude (subunits) to subtract from a subtotal. Always >= 0. */
export function discountAmount(discount: BillingDiscount, subtotal: number): number {
  if (subtotal <= 0) return 0;
  switch (discount.type) {
    case "percent": {
      const amt = roundPaise((subtotal * discount.value) / 100);
      return Math.min(amt, subtotal);
    }
    case "fixed_amount":
      return Math.min(discount.value, subtotal);
    case "free_trial":
      return subtotal;
  }
}

/** Count prior redemptions of a discount on a given subscription (cycle counter). */
export function redemptionCountForSubscription(
  redemptions: ReadonlyArray<BillingDiscountRedemption>,
  discountId: string,
  subscriptionId: string
): number {
  return redemptions.filter((r) => r.discountId === discountId && r.subscriptionId === subscriptionId).length;
}

export function assertDiscount(discount: BillingDiscount | null | undefined, code: string): BillingDiscount {
  if (!discount) {
    throw new BillingError("NOT_FOUND", `Discount not found for code: ${code}`, { code });
  }
  return discount;
}
