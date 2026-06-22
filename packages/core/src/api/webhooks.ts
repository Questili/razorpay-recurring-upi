/**
 * Webhook namespace. Verifies the provider signature, records an idempotent
 * audit row keyed on (provider, providerEventId), and reconciles each
 * provider-level fact onto kit records. The kit owns the provider->kit mapping;
 * adapters only parse + verify their own payload.
 *
 * Idempotency: a replayed event id is skipped. Event ordering races are handled
 * by state-machine guards in the reconciliation path.
 */
import { createHash } from "node:crypto";
import type { BillingContext } from "./context.js";
import { emit } from "./context.js";
import { BillingError } from "../errors.js";
import { applyProviderOutcome } from "./charge-engine.js";
import { mandateMachine, subscriptionMachine } from "../domain/state-machine.js";
import type { ProcessWebhookInput, ProcessWebhookResult } from "../types/api.js";
import type { ProviderWebhookEvent } from "../providers/types.js";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function createWebhooksApi(ctx: BillingContext) {
  async function process(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
    const provider = ctx.providers[input.provider];
    if (!provider) throw new BillingError("CONFIG_ERROR", `Provider not registered: ${input.provider}`);

    const normalized = await provider.normalizeWebhook({
      rawBody: input.rawBody,
      signature: input.signature,
      providerEventId: input.providerEventId
    });

    if (!normalized.verified) {
      throw new BillingError("WEBHOOK_VERIFICATION_FAILED", "Webhook signature verification failed");
    }

    const payloadHash = sha256(input.rawBody);
    const providerEventId = normalized.providerEventId ?? input.providerEventId ?? `hash:${payloadHash}`;
    const eventType = normalized.events[0]?.kind ?? "unknown";

    const attempt = await ctx.storage.recordWebhookEventAttempt({
      provider: input.provider,
      providerEventId,
      eventType,
      processedAt: null,
      status: "failed",
      payloadHash,
      error: null
    });
    if (!attempt.inserted) {
      if (attempt.record.status === "processed") {
        return { status: "skipped_duplicate", events: 0 };
      }
      if (attempt.record.payloadHash !== payloadHash) {
        await ctx.storage.updateWebhookEvent(attempt.record.id, {
          status: "failed",
          error: "providerEventId replayed with a different payload hash"
        });
        return {
          status: "failed",
          events: 0,
          error: "providerEventId replayed with a different payload hash"
        };
      }
    }

    let processed = 0;
    try {
      for (const ev of normalized.events) {
        await reconcile(ctx, ev);
        processed++;
      }
      await ctx.storage.updateWebhookEvent(attempt.record.id, { status: "processed", processedAt: ctx.clock.now(), error: null });
    } catch (err) {
      const error = String(err);
      ctx.logger.error("webhook reconciliation failed", { providerEventId, error });
      await ctx.storage.updateWebhookEvent(attempt.record.id, { status: "failed", processedAt: null, error });
      return { status: "failed", events: processed, error };
    }

    return { status: "processed", events: processed };
  }

  return { process };
}

async function reconcile(ctx: BillingContext, ev: ProviderWebhookEvent): Promise<void> {
  switch (ev.kind) {
    case "mandate.status": {
      const mandate = await ctx.storage.getMandateByToken("razorpay", ev.providerTokenId);
      if (!mandate) return;
      if (mandateMachine.canTransition(mandate.status, ev.status)) {
        await ctx.storage.updateMandate(mandate.id, { status: ev.status });
      }
      const sub = await ctx.storage.getActiveSubscriptionByCustomer(mandate.billingCustomerId);
      if (sub && sub.mandateId === mandate.id && ev.status !== "confirmed") {
        if (subscriptionMachine.canTransition(sub.status, "reauthorization_required")) {
          await ctx.storage.updateSubscription(sub.id, { status: "reauthorization_required" });
          await emit(ctx, { type: "subscription.reauthorization_required", subscriptionId: sub.id, reason: `mandate_${ev.status}`, at: ev.at });
        }
      }
      const et = ev.status;
      if (et === "confirmed") {
        await emit(ctx, { type: "mandate.authorized", mandateId: mandate.id, customerId: mandate.billingCustomerId, at: ev.at });
      } else if (et === "expired") {
        await emit(ctx, { type: "mandate.expired", mandateId: mandate.id, at: ev.at });
      } else if (et === "cancelled" || et === "rejected") {
        await emit(ctx, { type: "mandate.cancelled", mandateId: mandate.id, at: ev.at });
      } else if (et === "paused") {
        await emit(ctx, { type: "mandate.paused", mandateId: mandate.id, at: ev.at });
      }
      return;
    }
    case "payment.captured":
    case "payment.authorized": {
      const attempt = await ctx.storage.getChargeAttemptByProviderPaymentId(ev.providerPaymentId);
      if (attempt) {
        await applyProviderOutcome(ctx, { chargeAttemptId: attempt.id, state: "captured", providerPaymentId: ev.providerPaymentId });
        return;
      }
      // Otherwise this is likely the mandate setup payment -> confirm the mandate.
      const mandate = await ctx.storage.getMandateByAuthorizationPaymentId(ev.providerPaymentId);
      if (mandate && mandateMachine.canTransition(mandate.status, "confirmed")) {
        await ctx.storage.updateMandate(mandate.id, { status: "confirmed", authorizationPaymentId: ev.providerPaymentId });
        await emit(ctx, { type: "mandate.authorized", mandateId: mandate.id, customerId: mandate.billingCustomerId, at: ev.at });
      }
      return;
    }
    case "payment.failed": {
      if (!ev.providerPaymentId) return;
      const attempt = await ctx.storage.getChargeAttemptByProviderPaymentId(ev.providerPaymentId);
      if (attempt) {
        await applyProviderOutcome(ctx, { chargeAttemptId: attempt.id, state: "failed", providerPaymentId: ev.providerPaymentId, failure: ev.failure });
      }
      return;
    }
    case "refund.created": {
      ctx.logger.info("refund webhook received (not modeled in v1)", { providerPaymentId: ev.providerPaymentId, amount: ev.amount });
      return;
    }
    case "unknown":
      return;
  }
}
