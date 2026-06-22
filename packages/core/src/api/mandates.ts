/**
 * Mandate namespace. Creates a provider authorization (checkout) for UPI / card
 * / e-mandate recurring registration, verifies the checkout callback server-side
 * to extract the recurring token, and stores the mandate with safe metadata.
 *
 * Mandates are created in `initiated` state at authorization time and moved to
 * `confirmed` (with the real token) at callback verification. Raw secrets are
 * never stored — only a display label (e.g. bank + last4).
 */
import type { BillingContext } from "./context.js";
import { emit } from "./context.js";
import { BillingError, invalidArgument, notFound } from "../errors.js";
import { mandateMachine } from "../domain/state-machine.js";
import type {
  CreateMandateAuthorizationInput,
  MandateAuthorization,
  VerifyAuthorizationCallbackInput,
  VerifiedMandate
} from "../types/api.js";
import type { BillingMandate } from "../types/records.js";

export function createMandatesApi(ctx: BillingContext) {
  async function createAuthorization(input: CreateMandateAuthorizationInput): Promise<MandateAuthorization> {
    const method = input.method;
    if (!ctx.config.supportedMethods.includes(method)) {
      throw invalidArgument(`Unsupported payment method: ${method}`, { method });
    }
    const customer = await ctx.storage.getCustomerByExternalId(input.customer.id);
    if (!customer) {
      throw invalidArgument(`Customer not found. Call customers.ensure first for ${input.customer.id}`);
    }

    const provider = ctx.providers["razorpay"];
    if (!provider) throw new BillingError("CONFIG_ERROR", "Razorpay provider not registered");

    const existingProviderCustomer = (await ctx.storage.listProviderCustomers(customer.id)).find(
      (pc) => pc.provider === "razorpay"
    );
    const pc = await provider.createOrReuseCustomer({
      billingCustomerId: customer.id,
      providerCustomerId: existingProviderCustomer?.providerCustomerId ?? null,
      email: input.customer.email,
      name: input.customer.name,
      contact: input.customer.contact
    });
    await ctx.storage.createProviderCustomer({
      billingCustomerId: customer.id,
      provider: "razorpay",
      providerCustomerId: pc.providerCustomerId,
      metadata: { created: pc.created }
    });

    const auth = await provider.createAuthorization({
      providerCustomerId: pc.providerCustomerId,
      method,
      amount: input.amount,
      currency: input.currency ?? "INR",
      mandate: input.mandate,
      notes: { externalCustomerId: input.customer.id, ...(input.metadata ?? {}) }
    });

    const mandate = await ctx.storage.createMandate({
      billingCustomerId: customer.id,
      provider: "razorpay",
      providerCustomerId: pc.providerCustomerId,
      providerTokenId: null,
      authorizationPaymentId: null,
      authorizationOrderId: auth.providerOrderId,
      method,
      status: "initiated",
      currency: input.currency ?? "INR",
      maxAmount: input.mandate.maxAmount,
      frequency: input.mandate.frequency,
      expiresAt: input.mandate.expiresAt,
      safeInstrumentLabel: null,
      providerMetadata: { authorizationAmount: input.amount, metadata: input.metadata ?? {} }
    });

    return {
      authorizationId: mandate.id,
      provider: "razorpay",
      providerOrderId: auth.providerOrderId,
      providerCustomerId: pc.providerCustomerId,
      checkout: {
        keyId: auth.checkout.keyId,
        orderId: auth.checkout.orderId,
        customerId: auth.checkout.customerId,
        recurring: auth.checkout.recurring,
        method: auth.checkout.method
      }
    };
  }

  async function verifyAuthorizationCallback(input: VerifyAuthorizationCallbackInput): Promise<VerifiedMandate> {
    if (input.provider !== "razorpay") {
      throw invalidArgument(`Unsupported provider: ${input.provider}`);
    }
    const mandate = await ctx.storage.getMandate(input.authorizationId);
    if (!mandate) throw notFound("Mandate", input.authorizationId);

    const provider = ctx.providers["razorpay"];
    if (!provider) throw new BillingError("CONFIG_ERROR", "Razorpay provider not registered");

    const verified = await provider.verifyAuthorization({
      providerOrderId: mandate.authorizationOrderId ?? "",
      providerPaymentId: input.response.razorpay_payment_id,
      providerSignature: input.response.razorpay_signature,
      method: mandate.method
    });

    // De-dupe by token: if this token already belongs to another mandate, reuse it.
    const dupe = await ctx.storage.getMandateByToken("razorpay", verified.providerTokenId);
    if (dupe && dupe.id !== mandate.id) {
      mandateMachine.assertTransition(mandate.status, "cancelled");
      await ctx.storage.updateMandate(mandate.id, { status: "cancelled" });
      return {
        mandateId: dupe.id,
        providerTokenId: dupe.providerTokenId!,
        status: dupe.status,
        method: dupe.method,
        safeInstrumentLabel: dupe.safeInstrumentLabel,
        maxAmount: dupe.maxAmount
      };
    }

    const nextStatus = verified.status;
    mandateMachine.assertTransition(mandate.status, nextStatus);
    const updated = await ctx.storage.updateMandate(mandate.id, {
      providerTokenId: verified.providerTokenId,
      authorizationPaymentId: verified.providerPaymentId,
      status: nextStatus,
      maxAmount: verified.maxAmount || mandate.maxAmount,
      frequency: verified.frequency ?? mandate.frequency,
      expiresAt: verified.expiresAt ?? mandate.expiresAt,
      safeInstrumentLabel: verified.safeInstrumentLabel,
      providerMetadata: { ...mandate.providerMetadata, ...verified.providerMetadata }
    });

    if (nextStatus === "confirmed") {
      await emit(ctx, { type: "mandate.authorized", mandateId: mandate.id, customerId: mandate.billingCustomerId, at: ctx.clock.now() });
    }

    return {
      mandateId: updated.id,
      providerTokenId: updated.providerTokenId!,
      status: updated.status,
      method: updated.method,
      safeInstrumentLabel: updated.safeInstrumentLabel,
      maxAmount: updated.maxAmount
    };
  }

  async function cancel(mandateId: string): Promise<BillingMandate> {
    const mandate = await ctx.storage.getMandate(mandateId);
    if (!mandate) throw notFound("Mandate", mandateId);
    if (mandate.providerTokenId) {
      try {
        const res = await ctx.providers["razorpay"]!.cancelToken({ providerTokenId: mandate.providerTokenId });
        mandateMachine.assertTransition(mandate.status, res.status);
        await ctx.storage.updateMandate(mandateId, { status: res.status });
      } catch (err) {
        // Keep local cancellation intent; surface as a failed token cancel for retry.
        ctx.logger.warn("provider token cancel failed", { mandateId, error: String(err) });
        if (mandate.status !== "cancelled") {
          await ctx.storage.updateMandate(mandateId, { status: "cancelled" });
        }
      }
    } else {
      if (mandate.status !== "cancelled") {
        await ctx.storage.updateMandate(mandateId, { status: "cancelled" });
      }
    }
    const refreshed = await ctx.storage.getMandate(mandateId);
    await emit(ctx, { type: "mandate.cancelled", mandateId, at: ctx.clock.now() });
    return refreshed!;
  }

  return {
    createAuthorization,
    verifyAuthorizationCallback,
    cancel,
    get: (id: string) => ctx.storage.getMandate(id),
    listByCustomer: (customerId: string) => ctx.storage.listMandatesByCustomer(customerId)
  };
}
