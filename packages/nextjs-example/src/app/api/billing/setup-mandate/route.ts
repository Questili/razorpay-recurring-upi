/**
 * POST /api/billing/setup-mandate
 *
 * Begins the mandate authorization flow: ensures the billing customer exists,
 * then registers a Razorpay recurring authorization. Returns the checkout data
 * the browser needs to open Razorpay.js and collect the instrument (UPI / card).
 *
 * Body: { customerId, email, name, contact, method }
 */
import { NextResponse } from "next/server";
import { getBilling, isCheckoutMethodEnabled } from "@/lib/billing";
import type { BillingMethod } from "@questili/razorpay-recurring-upi";

const ALLOWED_METHODS: ReadonlySet<BillingMethod> = new Set(["upi", "card", "emandate"]);

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerId, email, name, contact, method } = (body ?? {}) as {
    customerId?: string;
    email?: string | null;
    name?: string | null;
    contact?: string | null;
    method?: string;
  };

  if (!customerId || typeof customerId !== "string") {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (!method || !ALLOWED_METHODS.has(method as BillingMethod)) {
    return NextResponse.json({ error: "method must be one of upi|card|emandate" }, { status: 400 });
  }
  if (!isCheckoutMethodEnabled(method as BillingMethod)) {
    return NextResponse.json(
      { error: "Selected Razorpay recurring method is not available in this key mode." },
      { status: 400 }
    );
  }
  const normalizedEmail = optionalText(email);
  const normalizedName = optionalText(name);
  const normalizedContact = optionalText(contact);

  try {
    const billing = getBilling();

    // 1. Idempotently ensure the billing customer for this external id.
    await billing.customers.ensure({
      id: customerId,
      email: normalizedEmail,
      name: normalizedName,
      contact: normalizedContact
    });

    // 2. Create the mandate authorization (Razorpay recurring checkout).
    const auth = await billing.mandates.createAuthorization({
      customer: {
        id: customerId,
        email: normalizedEmail,
        name: normalizedName,
        contact: normalizedContact
      },
      method: method as BillingMethod,
      amount: billing.config.defaultAuthorizationAmount,
      mandate: {
        maxAmount: billing.config.defaultMandateMaxAmount,
        // "as_presented": the mandate allows charges whenever presented (Razorpay
        // supports recurring charges at arbitrary cadence up to maxAmount).
        frequency: "as_presented",
        expiresAt: null
      },
      metadata: { source: "pricing_page" }
    });

    return NextResponse.json({
      authorizationId: auth.authorizationId,
      provider: auth.provider,
      providerOrderId: auth.providerOrderId,
      providerCustomerId: auth.providerCustomerId,
      checkout: auth.checkout
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "setup-mandate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
