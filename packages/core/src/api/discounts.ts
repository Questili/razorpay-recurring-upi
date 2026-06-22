/**
 * Discount namespace. Server-side code validation (active, in window, under max
 * redemptions, plan-eligible) and CRUD for discount definitions. Discount
 * effects are applied at invoice creation, not here.
 */
import type { BillingContext } from "./context.js";
import { validateDiscountCode } from "../domain/discount.js";
import type { ValidateDiscountInput, ValidateDiscountResult } from "../types/api.js";
import type { BillingDiscount } from "../types/records.js";

export type DiscountDefinition = Omit<BillingDiscount, "id" | "createdAt" | "updatedAt"> & { id: string };

export function createDiscountsApi(ctx: BillingContext) {
  async function validateCode(input: ValidateDiscountInput): Promise<ValidateDiscountResult> {
    const discount = await ctx.storage.getDiscountByCode(input.code);
    if (!discount) return { valid: false, reason: "not_found" };
    const redemptionCount = await ctx.storage.countDiscountRedemptions(discount.id);
    const result = validateDiscountCode(
      discount,
      { code: input.code, customerId: input.customerId, planId: input.planId, now: ctx.clock.now() },
      redemptionCount
    );
    if (!result.valid) return { valid: false, reason: result.reason };
    return {
      valid: true,
      discountId: discount.id,
      type: discount.type,
      value: discount.value
    };
  }

  return {
    validateCode,
    upsert: (def: DiscountDefinition) => ctx.storage.upsertDiscount(def),
    get: (id: string) => ctx.storage.getDiscount(id),
    getByCode: (code: string) => ctx.storage.getDiscountByCode(code),
    list: () => ctx.storage.listDiscounts()
  };
}
