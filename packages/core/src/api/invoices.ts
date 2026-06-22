/**
 * Invoice namespace. Read access plus void / mark-uncollectible and manual
 * adjustment invoices. Manual invoices let a host add a credit or one-off charge
 * outside the plan lifecycle.
 */
import type { BillingContext } from "./context.js";
import { notFound } from "../errors.js";
import { invoiceMachine } from "../domain/state-machine.js";
import { createInvoiceRecord } from "./invoice-builder.js";
import type { DraftAdjustmentLine } from "../domain/invoice.js";
import type { BillingInvoice } from "../types/records.js";

export function createInvoicesApi(ctx: BillingContext) {
  async function voidInvoice(invoiceId: string): Promise<BillingInvoice> {
    const invoice = await ctx.storage.getInvoice(invoiceId);
    if (!invoice) throw notFound("Invoice", invoiceId);
    invoiceMachine.assertTransition(invoice.status, "void");
    return ctx.storage.updateInvoice(invoiceId, { status: "void" });
  }

  async function markUncollectible(invoiceId: string): Promise<BillingInvoice> {
    const invoice = await ctx.storage.getInvoice(invoiceId);
    if (!invoice) throw notFound("Invoice", invoiceId);
    invoiceMachine.assertTransition(invoice.status, "uncollectible");
    return ctx.storage.updateInvoice(invoiceId, { status: "uncollectible" });
  }

  async function createManual(input: {
    subscriptionId: string;
    adjustments: DraftAdjustmentLine[];
    metadata?: Record<string, unknown>;
  }): Promise<BillingInvoice> {
    const sub = await ctx.storage.getSubscription(input.subscriptionId);
    if (!sub) throw notFound("Subscription", input.subscriptionId);
    const plan = await (await import("./context.js")).requirePlan(ctx, sub.planId);
    const { invoice } = await createInvoiceRecord(ctx, {
      subscription: sub,
      plan,
      reason: "manual_adjustment",
      period: { start: sub.currentPeriodStart, end: sub.currentPeriodEnd },
      now: ctx.clock.now(),
      adjustments: input.adjustments,
      metadata: input.metadata
    });
    return invoice;
  }

  return {
    get: (id: string) => ctx.storage.getInvoice(id),
    listBySubscription: (subscriptionId: string) => ctx.storage.listInvoicesBySubscription(subscriptionId),
    lines: (invoiceId: string) => ctx.storage.listInvoiceLines(invoiceId),
    void: voidInvoice,
    markUncollectible,
    createManual
  };
}
