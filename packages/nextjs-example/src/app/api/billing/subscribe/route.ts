/**
 * POST /api/billing/subscribe
 *
 * Creates a subscription over an authorized mandate and charges the initial
 * invoice immediately. The idempotency key is stable for the customer/mandate/plan
 * tuple so retries (e.g. a flaky network double-submit) don't double-charge.
 *
 * Body: { customerId, mandateId, planId }
 * Returns: { subscriptionId, invoiceId, charge }
 */
import { NextResponse } from "next/server";
import { getBilling } from "@/lib/billing";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerId, mandateId, planId } = (body ?? {}) as {
    customerId?: string;
    mandateId?: string;
    planId?: string;
  };

  if (!customerId || !mandateId || !planId) {
    return NextResponse.json(
      { error: "customerId, mandateId, planId are required" },
      { status: 400 }
    );
  }

  const billing = getBilling();
  const plan = billing.plans.get(planId);
  if (!plan) {
    return NextResponse.json({ error: `Unknown plan: ${planId}` }, { status: 400 });
  }

  try {
    const result = await billing.subscriptions.create({
      customerId,
      mandateId,
      planId,
      // Stable per customer/mandate/plan so a retry of the same submit cannot double-charge.
      idempotencyKey: `sub:${customerId}:${mandateId}:${planId}`
    });

    return NextResponse.json({
      subscriptionId: result.subscriptionId,
      invoiceId: result.invoiceId,
      charge: result.charge ?? null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "subscribe failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
