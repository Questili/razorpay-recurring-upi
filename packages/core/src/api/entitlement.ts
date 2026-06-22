/**
 * Entitlement namespace. Returns the access decision for a customer (by external
 * id) or a specific subscription. The host app performs the actual feature
 * gating; this only answers "does the customer have paid/trial/grace access now?".
 */
import type { BillingContext } from "./context.js";
import { computeEntitlement } from "../domain/entitlement.js";
import type { EntitlementResult } from "../types/api.js";

export function createEntitlementApi(ctx: BillingContext) {
  async function getAccessForCustomer(externalCustomerId: string): Promise<EntitlementResult> {
    const customer = await ctx.storage.getCustomerByExternalId(externalCustomerId);
    if (!customer) {
      return { hasAccess: false, reason: "no_subscription", accessEndsAt: new Date(0), graceEndsAt: new Date(0), subscriptionId: null, planId: null };
    }
    const subscription = await ctx.storage.getActiveSubscriptionByCustomer(customer.id);
    const decision = computeEntitlement(subscription, ctx.config, ctx.clock.now());
    return { ...decision, subscriptionId: subscription?.id ?? null, planId: subscription?.planId ?? null };
  }

  async function getAccessForSubscription(subscriptionId: string): Promise<EntitlementResult> {
    const subscription = await ctx.storage.getSubscription(subscriptionId);
    const decision = computeEntitlement(subscription, ctx.config, ctx.clock.now());
    return { ...decision, subscriptionId: subscription?.id ?? null, planId: subscription?.planId ?? null };
  }

  return { getAccessForCustomer, getAccessForSubscription };
}
