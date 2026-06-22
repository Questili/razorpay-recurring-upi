/**
 * POST /api/billing/webhook
 *
 * Razorpay webhook receiver. CRITICAL: the signature is computed over the
 * *raw* request body, so we read `await request.text()` and pass that exact
 * string to `billing.webhooks.process` — never JSON-parse it first.
 *
 * The kit verifies the signature, records an idempotent audit row keyed on
 * (provider, providerEventId), and reconciles provider facts onto local records.
 */
import { NextResponse } from "next/server";
import { getBilling } from "@/lib/billing";

export async function POST(request: Request): Promise<Response> {
  // Read the raw body once. Do NOT JSON.parse before signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get("X-Razorpay-Signature");
  const providerEventId = request.headers.get("x-razorpay-event-id");

  try {
    const billing = getBilling();
    const result = await billing.webhooks.process({
      provider: "razorpay",
      rawBody,
      signature,
      providerEventId
    });

    // 200 for processed / skipped_duplicate (idempotent replay). Both are healthy.
    if (result.status === "failed") {
      return NextResponse.json({ error: result.error ?? "webhook failed" }, { status: 500 });
    }
    return new NextResponse("ok", { status: 200 });
  } catch (err) {
    // Verification failures (bad/missing signature) must return 400 so Razorpay
    // doesn't keep hammering with the same invalid payload.
    const message = err instanceof Error ? err.message : "webhook failed";
    const status = /verif|signature/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
