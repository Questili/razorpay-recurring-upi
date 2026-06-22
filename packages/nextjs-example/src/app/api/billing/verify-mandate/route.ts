/**
 * POST /api/billing/verify-mandate
 *
 * Server-side verification of the Razorpay checkout callback. Verifies the
 * signature, fetches the payment, extracts the recurring token, and stores the
 * mandate in `confirmed` state. Returns the stable mandateId.
 *
 * Body: { authorizationId, razorpay_payment_id, razorpay_order_id, razorpay_signature }
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

  const { authorizationId, razorpay_payment_id, razorpay_order_id, razorpay_signature } =
    (body ?? {}) as {
      authorizationId?: string;
      razorpay_payment_id?: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    };

  if (!authorizationId || typeof authorizationId !== "string") {
    return NextResponse.json({ error: "authorizationId is required" }, { status: 400 });
  }
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return NextResponse.json(
      { error: "razorpay_payment_id, razorpay_order_id, razorpay_signature are required" },
      { status: 400 }
    );
  }

  try {
    const billing = getBilling();
    const verified = await billing.mandates.verifyAuthorizationCallback({
      provider: "razorpay",
      authorizationId,
      response: {
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature
      }
    });

    return NextResponse.json({
      mandateId: verified.mandateId,
      providerTokenId: verified.providerTokenId,
      status: verified.status,
      method: verified.method,
      safeInstrumentLabel: verified.safeInstrumentLabel,
      maxAmount: verified.maxAmount
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify-mandate failed";
    // Signature/verification failures are client errors (4xx), other failures are 5xx.
    const status = /verification|signature|verif/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
