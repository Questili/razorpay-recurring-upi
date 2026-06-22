/**
 * POST /api/billing/cancel
 *
 * Cancels a subscription either immediately or at period end.
 *
 * Body: { subscriptionId, timing: "immediate" | "period_end" }
 */
import { NextResponse } from "next/server";
import { getBilling } from "@/lib/billing";
import type { CancelTiming } from "@questili/razorpay-recurring-upi";

const TIMINGS: ReadonlySet<CancelTiming> = new Set(["immediate", "period_end"]);

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { subscriptionId, timing } = (body ?? {}) as {
    subscriptionId?: string;
    timing?: string;
  };

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
  }
  if (!timing || !TIMINGS.has(timing as CancelTiming)) {
    return NextResponse.json({ error: "timing must be immediate|period_end" }, { status: 400 });
  }

  try {
    const billing = getBilling();
    const updated = await billing.subscriptions.cancel({
      subscriptionId,
      timing: timing as CancelTiming,
      reason: "user_requested",
      // For immediate cancel, also revoke the provider token; for period_end the
      // mandate stays usable until the final renewal.
      cancelMandate: timing === "immediate"
    });

    return NextResponse.json({
      subscriptionId: updated.id,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      accessEndsAt: updated.accessEndsAt,
      canceledAt: updated.canceledAt
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "cancel failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
