/**
 * Subscription namespace. Creates local SaaS subscriptions over a registered
 * mandate, supports immediate/period-end cancellation and revive, and exposes
 * active-subscription lookup for entitlement reads.
 *
 * Period semantics:
 *  - No trial: period = [startsAt, startsAt + interval]; initial invoice charged
 *    immediately if an idempotency key is supplied.
 *  - Trial: period = [startsAt, trialEndsAt]; first paid invoice is deferred to
 *    trialEndsAt and built/charged by the renewal scheduler.
 */
import type { BillingContext } from "./context.js";
import { emit, getProvider, requirePlan } from "./context.js";
import { BillingError, invalidArgument, notFound } from "../errors.js";
import { subscriptionMachine } from "../domain/state-machine.js";
import { periodFor, addInterval } from "../domain/renewal-schedule.js";
import { mandateHealth } from "../domain/mandate.js";
import { createInvoiceRecord } from "./invoice-builder.js";
import { chargeInvoice } from "./charge-engine.js";
import type { CreateSubscriptionInput, CreateSubscriptionResult, CancelSubscriptionInput } from "../types/api.js";
import type { BillingSubscription } from "../types/records.js";

export function createSubscriptionsApi(ctx: BillingContext) {
  async function create(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const customer = await ctx.storage.getCustomerByExternalId(input.customerId);
    if (!customer) throw invalidArgument(`Customer not found: ${input.customerId}. Call customers.ensure first.`);
    const plan = await requirePlan(ctx, input.planId);
    // Config-defined plans are always considered active; stored plans carry an
    // `active` flag the host can check via billing.invoices/storage if needed.

    const mandate = await ctx.storage.getMandate(input.mandateId);
    if (!mandate) throw notFound("Mandate", input.mandateId);
    if (mandate.billingCustomerId !== customer.id) {
      throw invalidArgument("Mandate does not belong to this customer");
    }

    const existingActive = await ctx.storage.getActiveSubscriptionByCustomer(customer.id);
    if (existingActive) {
      throw invalidArgument("Customer already has an active subscription", {
        customerId: customer.externalCustomerId,
        subscriptionId: existingActive.id,
        status: existingActive.status
      });
    }

    if (mandateHealth(mandate, ctx.clock.now()) !== "usable") {
      throw new BillingError("MANDATE_INACTIVE", `Mandate ${input.mandateId} is not usable`, { status: mandate.status });
    }

    const now = ctx.clock.now();
    const startsAt = input.startsAt ?? now;
    const hasTrial = !!input.trialEndsAt && input.trialEndsAt.getTime() > now.getTime();

    const currentPeriodStart = startsAt;
    const currentPeriodEnd = hasTrial ? input.trialEndsAt! : addInterval(startsAt, plan.interval);
    const accessEndsAt = currentPeriodEnd;
    const nextBillingAt = currentPeriodEnd;

    const subscription = await ctx.storage.createSubscription({
      billingCustomerId: customer.id,
      mandateId: mandate.id,
      planId: plan.id,
      status: "active",
      currentPeriodStart,
      currentPeriodEnd,
      nextBillingAt,
      accessEndsAt,
      cancelAtPeriodEnd: false,
      cancellationRequestedAt: null,
      canceledAt: null,
      cancelReason: null,
      pendingPlanId: null,
      pendingPlanEffectiveAt: null,
      trialEndsAt: hasTrial ? input.trialEndsAt! : null,
      metadata: { attachedDiscountCodes: input.discountCodes ?? [] }
    });

    if (hasTrial) {
      await emit(ctx, { type: "subscription.activated", subscriptionId: subscription.id, at: now });
      return { subscriptionId: subscription.id, invoiceId: null };
    }

    // Build + (optionally) charge the initial invoice for the first period.
    const { invoice } = await createInvoiceRecord(ctx, {
      subscription,
      plan,
      reason: "initial",
      period: { start: currentPeriodStart, end: currentPeriodEnd },
      now,
      discountCodes: input.discountCodes
    });

    let charge: CreateSubscriptionResult["charge"];
    if (input.idempotencyKey) {
      const refreshedSub = (await ctx.storage.getSubscription(subscription.id))!;
      charge = await chargeInvoice(ctx, {
        invoice: (await ctx.storage.getInvoice(invoice.id))!,
        subscription: refreshedSub,
        mandate,
        plan,
        idempotencyKey: input.idempotencyKey
      });
    }

    return { subscriptionId: subscription.id, invoiceId: invoice.id, charge };
  }

  async function cancel(input: CancelSubscriptionInput): Promise<BillingSubscription> {
    const sub = await ctx.storage.getSubscription(input.subscriptionId);
    if (!sub) throw notFound("Subscription", input.subscriptionId);
    const now = ctx.clock.now();

    if (input.timing === "immediate") {
      if (sub.status === "canceled") return sub;
      subscriptionMachine.assertTransition(sub.status, "canceled");
      const updated = await ctx.storage.updateSubscription(sub.id, {
        status: "canceled",
        canceledAt: now,
        cancellationRequestedAt: sub.cancellationRequestedAt ?? now,
        cancelReason: input.reason,
        cancelAtPeriodEnd: false,
        accessEndsAt: now
      });
      if (input.cancelMandate) {
        await cancelSubscriptionMandate(ctx, sub, "immediate");
      }
      await emit(ctx, { type: "subscription.canceled", subscriptionId: sub.id, at: now });
      return updated;
    }

    // period_end
    if (sub.status !== "cancel_at_period_end" && sub.status !== "canceled") {
      subscriptionMachine.assertTransition(sub.status, "cancel_at_period_end");
      const updated = await ctx.storage.updateSubscription(sub.id, {
        status: "cancel_at_period_end",
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: now,
        cancelReason: input.reason
      });
      if (input.cancelMandate) {
        await cancelSubscriptionMandate(ctx, sub, "period_end");
      }
      return updated;
    }
    return sub;
  }

  async function revive(subscriptionId: string): Promise<BillingSubscription> {
    const sub = await ctx.storage.getSubscription(subscriptionId);
    if (!sub) throw notFound("Subscription", subscriptionId);
    if (sub.status === "cancel_at_period_end") {
      subscriptionMachine.assertTransition(sub.status, "active");
      return ctx.storage.updateSubscription(subscriptionId, {
        status: "active",
        cancelAtPeriodEnd: false,
        cancellationRequestedAt: null,
        cancelReason: null
      });
    }
    return sub;
  }

  return {
    create,
    cancel,
    revive,
    get: (id: string) => ctx.storage.getSubscription(id),
    getActiveForCustomer: (customerId: string) => ctx.storage.getActiveSubscriptionByCustomer(customerId)
  };
}

async function cancelSubscriptionMandate(
  ctx: BillingContext,
  sub: BillingSubscription,
  timing: "immediate" | "period_end"
): Promise<void> {
  if (!sub.mandateId) return;

  const mandate = await ctx.storage.getMandate(sub.mandateId);
  if (!mandate?.providerTokenId) return;

  const provider = getProvider(ctx, mandate.provider);
  await provider.cancelToken({ providerTokenId: mandate.providerTokenId }).catch((err: unknown) => {
    ctx.logger.warn("mandate cancel failed during subscription cancel", {
      subscriptionId: sub.id,
      mandateId: mandate.id,
      provider: mandate.provider,
      timing,
      error: String(err)
    });
  });
}

export { periodFor };
