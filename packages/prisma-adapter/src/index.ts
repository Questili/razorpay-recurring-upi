/**
 * @questili/razorpay-recurring-upi-prisma
 *
 * Production PostgreSQL storage adapter for
 * {@link BillingStorage} via Prisma. Wire it into `createRazorpayRecurringUpiBilling`
 * to persist mandates, subscriptions, invoices, dunning, discounts, and webhook
 * idempotency records.
 */
import { PrismaBillingStorage } from "./adapter.js";
import type { PrismaClientLike, PrismaStorageOptions } from "./adapter.js";

export { PrismaBillingStorage };
export type { PrismaClientLike, PrismaStorageOptions };

/**
 * Build a {@link PrismaBillingStorage} from a generated `PrismaClient` instance.
 *
 * @example
 *   import { PrismaClient } from "@prisma/client";
 *   const prisma = new PrismaClient();
 *   const billing = createRazorpayRecurringUpiBilling({ storage: createPrismaStorage(prisma), ... });
 */
export function createPrismaStorage(
  client: PrismaClientLike,
  opts?: PrismaStorageOptions
): PrismaBillingStorage {
  return new PrismaBillingStorage(client, opts);
}

// Re-export the shared storage contract + supporting types so consumers can
// import everything from this package.
export type {
  BillingStorage,
  Clock,
  IdFactory,
  BillingCustomer,
  BillingProviderCustomer,
  BillingMandate,
  BillingPlan,
  BillingSubscription,
  BillingInvoice,
  BillingInvoiceLine,
  BillingChargeAttempt,
  BillingDiscount,
  BillingDiscountRedemption,
  BillingWebhookEvent,
  ProviderName,
  SubscriptionStatus
} from "@questili/razorpay-recurring-upi";
