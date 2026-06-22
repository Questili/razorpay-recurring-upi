/**
 * Mandate health helpers. A mandate is "usable" only when confirmed, not
 * expired, and the requested amount is within maxAmount. SPEC mandate policy:
 * never charge above the cap; if a mandate is paused/cancelled/expired/rejected/
 * invalid, the subscription must move to reauthorization_required.
 */
import type { MandateHealth } from "../types/enums.js";
import type { BillingMandate } from "../types/records.js";

export function mandateHealth(mandate: BillingMandate, now: Date): MandateHealth {
  if (mandate.status === "paused") return "paused";
  if (mandate.status !== "confirmed") return "inactive";
  if (mandate.expiresAt && now.getTime() > mandate.expiresAt.getTime()) return "inactive";
  return "usable";
}

export function canChargeMandate(mandate: BillingMandate, amount: number, now: Date): boolean {
  if (amount <= 0) return true; // Nothing to charge; no mandate constraint applies.
  if (mandateHealth(mandate, now) !== "usable") return false;
  return amount <= mandate.maxAmount;
}

export function exceedsMandateCap(mandate: BillingMandate, amount: number): boolean {
  return amount > mandate.maxAmount;
}
