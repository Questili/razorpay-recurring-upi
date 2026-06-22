/**
 * Plan-change namespace. Preview computes the upgrade invoice (proration) or the
 * scheduled downgrade; confirm executes it. Immediate upgrades that exceed the
 * mandate cap or hit an unusable mandate return reauthorization_required instead
 * of charging (SPEC "Mandate cap exceeded").
 *
 * previewId is a self-contained, HMAC-signed token carrying the negotiated
 * terms; confirm verifies the signature, re-derives the preview, and rejects a
 * stale token (amount drift) before charging, so a preview and confirm always
 * agree without trusting client-mutated data.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingContext } from "./context.js";
import { requirePlan } from "./context.js";
import { BillingError, invalidArgument, notFound } from "../errors.js";
import { buildInvoice, chargeableAmount } from "../domain/invoice.js";
import { mandateHealth, exceedsMandateCap } from "../domain/mandate.js";
import { createInvoiceRecord } from "./invoice-builder.js";
import { chargeInvoice } from "./charge-engine.js";
import type {
  ConfirmPlanChangeInput,
  PlanChangePreview,
  PlanChangePreviewInput,
  PlanChangeResult
} from "../types/api.js";

interface PreviewToken {
  subscriptionId: string;
  targetPlanId: string;
  timing: "immediate" | "period_end";
  discountCodes: string[];
  amountDue: number;
  issuedAt: number;
}

function encode(t: PreviewToken, secret: string): string {
  const payload = Buffer.from(JSON.stringify(t), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function decode(s: string, secret: string): PreviewToken {
  const [payload, signature, ...rest] = s.split(".");
  if (!payload || !signature || rest.length > 0 || !safeEqual(signature, sign(payload, secret))) {
    throw invalidArgument("Invalid or tampered plan-change previewId");
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewToken;
  } catch {
    throw invalidArgument("Invalid plan-change previewId payload");
  }
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createPlanChangesApi(ctx: BillingContext) {
  async function preview(input: PlanChangePreviewInput): Promise<PlanChangePreview> {
    const sub = await ctx.storage.getSubscription(input.subscriptionId);
    if (!sub) throw notFound("Subscription", input.subscriptionId);
    const targetPlan = await requirePlan(ctx, input.targetPlanId);
    const currentPlan = await requirePlan(ctx, sub.planId);
    const mandate = sub.mandateId ? await ctx.storage.getMandate(sub.mandateId) : undefined;
    if (!mandate) throw notFound("Mandate", sub.mandateId ?? "");
    const now = ctx.clock.now();

    if (input.timing === "immediate") {
      if (targetPlan.amount < currentPlan.amount) {
        throw invalidArgument("Immediate downgrade is not supported; use timing: period_end", {
          current: currentPlan.amount,
          target: targetPlan.amount
        });
      }
      const usable = mandateHealth(mandate, now) === "usable";
      const draft = buildInvoice({
        plan: targetPlan,
        reason: "upgrade",
        period: { start: now, end: sub.currentPeriodEnd },
        now,
        upgradeFromAmount: currentPlan.amount
      });
      const amountDue = chargeableAmount(draft.total);
      const previewId = encode(
        {
          subscriptionId: sub.id,
          targetPlanId: targetPlan.id,
          timing: "immediate",
          discountCodes: input.discountCodes ?? [],
          amountDue,
          issuedAt: now.getTime()
        },
        ctx.config.previewTokenSecret
      );
      return {
        id: previewId,
        subscriptionId: sub.id,
        targetPlanId: targetPlan.id,
        timing: "immediate",
        amountDue,
        subtotal: draft.subtotal,
        discountTotal: draft.discountTotal,
        lines: draft.lines.map((l) => ({ type: l.type, description: l.description, amount: l.amount })),
        exceedsMandateCap: exceedsMandateCap(mandate, amountDue),
        mandateUsable: usable,
        effectiveAt: now
      };
    }

    // period_end downgrade
    const previewId = encode(
      {
        subscriptionId: sub.id,
        targetPlanId: targetPlan.id,
        timing: "period_end",
        discountCodes: input.discountCodes ?? [],
        amountDue: 0,
        issuedAt: now.getTime()
      },
      ctx.config.previewTokenSecret
    );
    return {
      id: previewId,
      subscriptionId: sub.id,
      targetPlanId: targetPlan.id,
      timing: "period_end",
      amountDue: 0,
      subtotal: 0,
      discountTotal: 0,
      lines: [],
      exceedsMandateCap: false,
      mandateUsable: mandateHealth(mandate, now) === "usable",
      effectiveAt: sub.currentPeriodEnd
    };
  }

  async function confirm(input: ConfirmPlanChangeInput): Promise<PlanChangeResult> {
    const token = decode(input.previewId, ctx.config.previewTokenSecret);
    if (token.subscriptionId !== input.subscriptionId) {
      throw new BillingError("CONFLICT", "previewId does not match subscription", {});
    }
    const recomputed = await preview({
      subscriptionId: input.subscriptionId,
      targetPlanId: token.targetPlanId,
      timing: token.timing,
      discountCodes: token.discountCodes
    });
    if (recomputed.amountDue !== token.amountDue) {
      throw new BillingError("CONFLICT", "Plan-change preview is stale; re-preview before confirming", {
        was: token.amountDue,
        now: recomputed.amountDue
      });
    }

    const sub = await ctx.storage.getSubscription(input.subscriptionId);
    if (!sub) throw notFound("Subscription", input.subscriptionId);
    const targetPlan = await requirePlan(ctx, token.targetPlanId);
    const mandate = sub.mandateId ? await ctx.storage.getMandate(sub.mandateId) : undefined;
    if (!mandate) throw notFound("Mandate", sub.mandateId ?? "");

    if (token.timing === "period_end") {
      await ctx.storage.updateSubscription(sub.id, {
        pendingPlanId: targetPlan.id,
        pendingPlanEffectiveAt: sub.currentPeriodEnd
      });
      return { status: "scheduled", subscriptionId: sub.id, effectiveAt: sub.currentPeriodEnd };
    }

    // immediate upgrade
    if (!recomputed.mandateUsable) {
      return { status: "reauthorization_required", reason: "mandate_not_usable" };
    }
    if (recomputed.exceedsMandateCap) {
      return { status: "reauthorization_required", reason: "mandate_cap_exceeded" };
    }

    const currentPlan = await requirePlan(ctx, sub.planId);
    const now = ctx.clock.now();
    const { invoice } = await createInvoiceRecord(ctx, {
      subscription: sub,
      plan: targetPlan,
      reason: "upgrade",
      period: { start: now, end: sub.currentPeriodEnd },
      now,
      upgradeFromAmount: currentPlan.amount,
      discountCodes: token.discountCodes.length > 0 ? token.discountCodes : null,
      metadata: { targetPlanId: targetPlan.id }
    });

    return chargeInvoice(ctx, {
      invoice,
      subscription: sub,
      mandate,
      plan: targetPlan,
      idempotencyKey: input.idempotencyKey
    });
  }

  return { preview, confirm };
}
