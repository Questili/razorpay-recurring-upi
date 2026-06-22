/**
 * Customer namespace. Idempotently ensures a billing customer exists for a host
 * app's external id. Host apps call this before mandate authorization.
 */
import type { BillingContext } from "./context.js";
import type { CustomerInput } from "../types/api.js";
import type { BillingCustomer } from "../types/records.js";

export function createCustomersApi(ctx: BillingContext) {
  async function ensure(customer: CustomerInput): Promise<BillingCustomer> {
    const existing = await ctx.storage.getCustomerByExternalId(customer.id);
    if (existing) {
      const patch: Partial<BillingCustomer> = {};
      if (customer.email !== existing.email) patch.email = customer.email;
      if (customer.name !== existing.name) patch.name = customer.name;
      if (customer.contact !== existing.contact) patch.contact = customer.contact;
      if (Object.keys(patch).length > 0) {
        return ctx.storage.updateCustomer(existing.id, patch);
      }
      return existing;
    }
    return ctx.storage.createCustomer({
      externalCustomerId: customer.id,
      email: customer.email,
      name: customer.name,
      contact: customer.contact
    });
  }

  return {
    ensure,
    get: (id: string) => ctx.storage.getCustomer(id),
    getByExternalId: (externalId: string) => ctx.storage.getCustomerByExternalId(externalId)
  };
}
