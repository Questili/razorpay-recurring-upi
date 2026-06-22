/**
 * Entitlement engine. The kit returns an access decision; the host app performs
 * the actual feature gating (SPEC: "host apps own final entitlement enforcement").
 *
 * Policy (SPEC "Access policy"):
 *  - active / cancel_at_period_end: paid access until accessEndsAt.
 *  - payment_pending: access until grace deadline.
 *  - past_due: access during grace (host can tighten).
 *  - reauthorization_required / canceled: access until accessEndsAt, then off.
 *  - expired / draft / pending_authorization: no access.
 *  - A future trialEndsAt grants trial access regardless of payment state.
 */
import type { AccessReason } from "../types/enums.js";
import type { BillingConfig } from "../types/config.js";
import type { BillingSubscription } from "../types/records.js";
import { DAY_MS } from "./renewal-schedule.js";

export interface AccessDecision {
  hasAccess: boolean;
  reason: AccessReason;
  accessEndsAt: Date;
  graceEndsAt: Date;
}

export function computeEntitlement(
  subscription: BillingSubscription | null | undefined,
  config: BillingConfig,
  now: Date
): AccessDecision {
  if (!subscription) {
    const epoch = new Date(0);
    return { hasAccess: false, reason: "no_subscription", accessEndsAt: epoch, graceEndsAt: epoch };
  }

  const accessEndsAt = subscription.accessEndsAt;
  const graceEndsAt = new Date(accessEndsAt.getTime() + config.gracePeriodDays * DAY_MS);
  const nowMs = now.getTime();

  if (subscription.trialEndsAt && nowMs < subscription.trialEndsAt.getTime()) {
    return { hasAccess: true, reason: "trial", accessEndsAt, graceEndsAt };
  }

  switch (subscription.status) {
    case "active":
    case "cancel_at_period_end":
      if (nowMs <= accessEndsAt.getTime()) {
        return {
          hasAccess: true,
          reason: subscription.status === "cancel_at_period_end" ? "cancel_at_period_end" : "active",
          accessEndsAt,
          graceEndsAt
        };
      }
      return { hasAccess: false, reason: "expired", accessEndsAt, graceEndsAt };
    case "past_due":
    case "payment_pending":
      if (nowMs <= graceEndsAt.getTime()) {
        return { hasAccess: true, reason: "grace", accessEndsAt, graceEndsAt };
      }
      return { hasAccess: false, reason: "inactive", accessEndsAt, graceEndsAt };
    case "reauthorization_required":
    case "canceled":
      if (nowMs <= accessEndsAt.getTime()) {
        return { hasAccess: true, reason: "active", accessEndsAt, graceEndsAt };
      }
      return { hasAccess: false, reason: "inactive", accessEndsAt, graceEndsAt };
    case "expired":
      return { hasAccess: false, reason: "expired", accessEndsAt, graceEndsAt };
    case "draft":
    case "pending_authorization":
      return { hasAccess: false, reason: "pending_authorization", accessEndsAt, graceEndsAt };
  }
}
