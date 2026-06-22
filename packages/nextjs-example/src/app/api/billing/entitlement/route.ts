/**
 * GET /api/billing/entitlement?customerId=...
 *
 * Returns the access decision for an external customer id: whether they have
 * paid/trial/grace access right now, when access ends, and which subscription
 * + plan backs it. Host apps use this for feature gating.
 */
import { NextResponse } from "next/server";
import { getBilling } from "@/lib/billing";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");

  if (!customerId) {
    return NextResponse.json({ error: "customerId query param is required" }, { status: 400 });
  }

  try {
    const billing = getBilling();
    const access = await billing.entitlement.getAccessForCustomer(customerId);
    return NextResponse.json(access);
  } catch (err) {
    const message = err instanceof Error ? err.message : "entitlement lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
