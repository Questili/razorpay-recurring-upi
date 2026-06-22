/**
 * Storage-neutral persistence interface. The core never touches a database
 * directly; it calls this interface. Adapters (in-memory for tests, Prisma for
 * production) implement it. Methods that mutate a primary entity return the
 * updated record; find methods return `undefined` for not-found.
 *
 * Lookup-by-natural-key helpers (provider customer, provider event id, mandate
 * by token) exist to support idempotency and reuse without leaking provider
 * concepts into the domain records.
 */
import type {
  BillingChargeAttempt,
  BillingCustomer,
  BillingDiscount,
  BillingDiscountRedemption,
  BillingInvoice,
  BillingInvoiceLine,
  BillingMandate,
  BillingPlan,
  BillingProviderCustomer,
  BillingSubscription,
  BillingWebhookEvent
} from "../types/records.js";
import type { ProviderName } from "../types/enums.js";

export interface BillingStorage {
  // Customers
  createCustomer(input: Omit<BillingCustomer, "id" | "createdAt" | "updatedAt">): Promise<BillingCustomer>;
  getCustomer(id: string): Promise<BillingCustomer | undefined>;
  getCustomerByExternalId(externalCustomerId: string): Promise<BillingCustomer | undefined>;
  updateCustomer(id: string, patch: Partial<Omit<BillingCustomer, "id" | "createdAt">>): Promise<BillingCustomer>;

  // Provider customers
  createProviderCustomer(input: Omit<BillingProviderCustomer, "id" | "createdAt" | "updatedAt">): Promise<BillingProviderCustomer>;
  getProviderCustomer(provider: ProviderName, providerCustomerId: string): Promise<BillingProviderCustomer | undefined>;
  listProviderCustomers(billingCustomerId: string): Promise<BillingProviderCustomer[]>;

  // Plans
  upsertPlan(input: Omit<BillingPlan, "id" | "createdAt" | "updatedAt"> & { id: string }): Promise<BillingPlan>;
  getPlan(id: string): Promise<BillingPlan | undefined>;
  listPlans(): Promise<BillingPlan[]>;

  // Mandates
  createMandate(input: Omit<BillingMandate, "id" | "createdAt" | "updatedAt">): Promise<BillingMandate>;
  getMandate(id: string): Promise<BillingMandate | undefined>;
  getMandateByToken(provider: ProviderName, providerTokenId: string): Promise<BillingMandate | undefined>;
  getMandateByAuthorizationPaymentId(providerPaymentId: string): Promise<BillingMandate | undefined>;
  updateMandate(id: string, patch: Partial<Omit<BillingMandate, "id" | "createdAt">>): Promise<BillingMandate>;
  listMandatesByCustomer(billingCustomerId: string): Promise<BillingMandate[]>;

  // Subscriptions
  createSubscription(input: Omit<BillingSubscription, "id" | "createdAt" | "updatedAt">): Promise<BillingSubscription>;
  getSubscription(id: string): Promise<BillingSubscription | undefined>;
  getActiveSubscriptionByCustomer(billingCustomerId: string): Promise<BillingSubscription | undefined>;
  updateSubscription(id: string, patch: Partial<Omit<BillingSubscription, "id" | "createdAt">>): Promise<BillingSubscription>;
  listSubscriptionsDueForRenewal(before: Date): Promise<BillingSubscription[]>;
  listSubscriptionsPastDue(): Promise<BillingSubscription[]>;
  listSubscriptionsPaymentPending(): Promise<BillingSubscription[]>;
  listSubscriptionsByStatus(status: import("../types/enums.js").SubscriptionStatus): Promise<BillingSubscription[]>;

  // Invoices
  createInvoice(input: Omit<BillingInvoice, "id" | "createdAt" | "updatedAt">): Promise<BillingInvoice>;
  getInvoice(id: string): Promise<BillingInvoice | undefined>;
  updateInvoice(id: string, patch: Partial<Omit<BillingInvoice, "id" | "createdAt">>): Promise<BillingInvoice>;
  listInvoicesBySubscription(subscriptionId: string): Promise<BillingInvoice[]>;

  // Invoice lines
  createInvoiceLines(lines: Array<Omit<BillingInvoiceLine, "id" | "createdAt" | "updatedAt">>): Promise<BillingInvoiceLine[]>;
  listInvoiceLines(invoiceId: string): Promise<BillingInvoiceLine[]>;

  // Charge attempts
  createChargeAttempt(input: Omit<BillingChargeAttempt, "id" | "createdAt" | "updatedAt">): Promise<BillingChargeAttempt>;
  getChargeAttempt(id: string): Promise<BillingChargeAttempt | undefined>;
  getChargeAttemptByIdempotencyKey(idempotencyKey: string): Promise<BillingChargeAttempt | undefined>;
  getChargeAttemptByProviderPaymentId(providerPaymentId: string): Promise<BillingChargeAttempt | undefined>;
  updateChargeAttempt(id: string, patch: Partial<Omit<BillingChargeAttempt, "id" | "createdAt">>): Promise<BillingChargeAttempt>;
  listChargeAttemptsByInvoice(invoiceId: string): Promise<BillingChargeAttempt[]>;
  listChargeAttemptsBySubscription(subscriptionId: string): Promise<BillingChargeAttempt[]>;
  listChargeAttemptsToRetry(before: Date): Promise<BillingChargeAttempt[]>;

  // Discounts
  upsertDiscount(input: Omit<BillingDiscount, "id" | "createdAt" | "updatedAt"> & { id: string }): Promise<BillingDiscount>;
  getDiscount(id: string): Promise<BillingDiscount | undefined>;
  getDiscountByCode(code: string): Promise<BillingDiscount | undefined>;
  listDiscounts(): Promise<BillingDiscount[]>;
  countDiscountRedemptions(discountId: string): Promise<number>;
  listDiscountRedemptionsForSubscription(discountId: string, subscriptionId: string): Promise<BillingDiscountRedemption[]>;
  createDiscountRedemption(input: Omit<BillingDiscountRedemption, "id" | "createdAt" | "updatedAt">): Promise<BillingDiscountRedemption>;

  // Webhooks
  recordWebhookEventAttempt(input: Omit<BillingWebhookEvent, "id" | "createdAt" | "updatedAt">): Promise<{ inserted: boolean; record: BillingWebhookEvent }>;
  getWebhookEvent(provider: ProviderName, providerEventId: string): Promise<BillingWebhookEvent | undefined>;
  updateWebhookEvent(id: string, patch: Partial<Omit<BillingWebhookEvent, "id" | "createdAt">>): Promise<BillingWebhookEvent>;
}
