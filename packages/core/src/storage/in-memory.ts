/**
 * In-memory storage adapter. Deterministic, dependency-free implementation of
 * {@link BillingStorage} used for tests, examples, and local development. Enforces
 * the same uniqueness / idempotency invariants a real DB adapter must (provider
 * customer uniqueness, token uniqueness, webhook event idempotency).
 */
import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import { randomIdFactory } from "../ids.js";
import type { IdFactory } from "../ids.js";
import { BillingError, notFound } from "../errors.js";
import type { ProviderName, SubscriptionStatus } from "../types/enums.js";
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
import type { BillingStorage } from "./types.js";

export interface InMemoryStorageOptions {
  clock?: Clock;
  idFactory?: IdFactory;
}

interface Tables {
  customers: Map<string, BillingCustomer>;
  providerCustomers: Map<string, BillingProviderCustomer>;
  plans: Map<string, BillingPlan>;
  mandates: Map<string, BillingMandate>;
  subscriptions: Map<string, BillingSubscription>;
  invoices: Map<string, BillingInvoice>;
  invoiceLines: Map<string, BillingInvoiceLine>;
  chargeAttempts: Map<string, BillingChargeAttempt>;
  discounts: Map<string, BillingDiscount>;
  redemptions: Map<string, BillingDiscountRedemption>;
  webhooks: Map<string, BillingWebhookEvent>;
}

export class InMemoryBillingStorage implements BillingStorage {
  private t: Tables = {
    customers: new Map(),
    providerCustomers: new Map(),
    plans: new Map(),
    mandates: new Map(),
    subscriptions: new Map(),
    invoices: new Map(),
    invoiceLines: new Map(),
    chargeAttempts: new Map(),
    discounts: new Map(),
    redemptions: new Map(),
    webhooks: new Map()
  };
  private readonly clock: Clock;
  private readonly id: IdFactory;

  constructor(opts: InMemoryStorageOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.id = opts.idFactory ?? randomIdFactory;
  }

  private now(): Date {
    return this.clock.now();
  }

  private providerCustomerKey(provider: ProviderName, providerCustomerId: string): string {
    return `${provider}:${providerCustomerId}`;
  }

  // ---- Customers ----
  async createCustomer(input: Omit<BillingCustomer, "id" | "createdAt" | "updatedAt">): Promise<BillingCustomer> {
    const now = this.now();
    const rec: BillingCustomer = { ...input, id: this.id("cust"), createdAt: now, updatedAt: now };
    this.t.customers.set(rec.id, rec);
    return rec;
  }
  async getCustomer(id: string): Promise<BillingCustomer | undefined> {
    return this.t.customers.get(id);
  }
  async getCustomerByExternalId(externalCustomerId: string): Promise<BillingCustomer | undefined> {
    for (const c of this.t.customers.values()) {
      if (c.externalCustomerId === externalCustomerId) return c;
    }
    return undefined;
  }
  async updateCustomer(id: string, patch: Partial<Omit<BillingCustomer, "id" | "createdAt">>): Promise<BillingCustomer> {
    const existing = this.t.customers.get(id);
    if (!existing) throw notFound("Customer", id);
    const updated: BillingCustomer = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.customers.set(id, updated);
    return updated;
  }

  // ---- Provider customers ----
  async createProviderCustomer(input: Omit<BillingProviderCustomer, "id" | "createdAt" | "updatedAt">): Promise<BillingProviderCustomer> {
    const key = this.providerCustomerKey(input.provider, input.providerCustomerId);
    const existing = this.t.providerCustomers.get(key);
    if (existing) return existing;
    const now = this.now();
    const rec: BillingProviderCustomer = { ...input, id: this.id("pcust"), createdAt: now, updatedAt: now };
    this.t.providerCustomers.set(key, rec);
    return rec;
  }
  async getProviderCustomer(provider: ProviderName, providerCustomerId: string): Promise<BillingProviderCustomer | undefined> {
    return this.t.providerCustomers.get(this.providerCustomerKey(provider, providerCustomerId));
  }
  async listProviderCustomers(billingCustomerId: string): Promise<BillingProviderCustomer[]> {
    return [...this.t.providerCustomers.values()].filter((p) => p.billingCustomerId === billingCustomerId);
  }

  // ---- Plans ----
  async upsertPlan(input: Omit<BillingPlan, "id" | "createdAt" | "updatedAt"> & { id: string }): Promise<BillingPlan> {
    const now = this.now();
    const existing = this.t.plans.get(input.id);
    const rec: BillingPlan = { ...(existing ?? { createdAt: now }), ...input, updatedAt: now } as BillingPlan;
    this.t.plans.set(input.id, rec);
    return rec;
  }
  async getPlan(id: string): Promise<BillingPlan | undefined> {
    return this.t.plans.get(id);
  }
  async listPlans(): Promise<BillingPlan[]> {
    return [...this.t.plans.values()];
  }

  // ---- Mandates ----
  async createMandate(input: Omit<BillingMandate, "id" | "createdAt" | "updatedAt">): Promise<BillingMandate> {
    if (input.providerTokenId && (await this.getMandateByToken(input.provider, input.providerTokenId))) {
      throw new BillingError("CONFLICT", `Mandate already exists for token ${input.providerTokenId}`);
    }
    const now = this.now();
    const rec: BillingMandate = { ...input, id: this.id("mand"), createdAt: now, updatedAt: now };
    this.t.mandates.set(rec.id, rec);
    return rec;
  }
  async getMandate(id: string): Promise<BillingMandate | undefined> {
    return this.t.mandates.get(id);
  }
  async getMandateByToken(provider: ProviderName, providerTokenId: string): Promise<BillingMandate | undefined> {
    for (const m of this.t.mandates.values()) {
      if (m.provider === provider && m.providerTokenId === providerTokenId) return m;
    }
    return undefined;
  }
  async getMandateByAuthorizationPaymentId(providerPaymentId: string): Promise<BillingMandate | undefined> {
    for (const m of this.t.mandates.values()) {
      if (m.authorizationPaymentId === providerPaymentId) return m;
    }
    return undefined;
  }
  async updateMandate(id: string, patch: Partial<Omit<BillingMandate, "id" | "createdAt">>): Promise<BillingMandate> {
    const existing = this.t.mandates.get(id);
    if (!existing) throw notFound("Mandate", id);
    const updated: BillingMandate = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.mandates.set(id, updated);
    return updated;
  }
  async listMandatesByCustomer(billingCustomerId: string): Promise<BillingMandate[]> {
    return [...this.t.mandates.values()].filter((m) => m.billingCustomerId === billingCustomerId);
  }

  // ---- Subscriptions ----
  async createSubscription(input: Omit<BillingSubscription, "id" | "createdAt" | "updatedAt">): Promise<BillingSubscription> {
    const now = this.now();
    const rec: BillingSubscription = { ...input, id: this.id("sub"), createdAt: now, updatedAt: now };
    this.t.subscriptions.set(rec.id, rec);
    return rec;
  }
  async getSubscription(id: string): Promise<BillingSubscription | undefined> {
    return this.t.subscriptions.get(id);
  }
  async getActiveSubscriptionByCustomer(billingCustomerId: string): Promise<BillingSubscription | undefined> {
    const activeStatuses: SubscriptionStatus[] = ["active", "past_due", "payment_pending", "reauthorization_required", "cancel_at_period_end", "pending_authorization"];
    for (const s of this.t.subscriptions.values()) {
      if (s.billingCustomerId === billingCustomerId && activeStatuses.includes(s.status)) return s;
    }
    return undefined;
  }
  async updateSubscription(id: string, patch: Partial<Omit<BillingSubscription, "id" | "createdAt">>): Promise<BillingSubscription> {
    const existing = this.t.subscriptions.get(id);
    if (!existing) throw notFound("Subscription", id);
    const updated: BillingSubscription = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.subscriptions.set(id, updated);
    return updated;
  }
  async listSubscriptionsDueForRenewal(before: Date): Promise<BillingSubscription[]> {
    return [...this.t.subscriptions.values()].filter(
      (s) => s.status === "active" && s.nextBillingAt != null && s.nextBillingAt.getTime() <= before.getTime()
    );
  }
  async listSubscriptionsPastDue(): Promise<BillingSubscription[]> {
    return [...this.t.subscriptions.values()].filter((s) => s.status === "past_due");
  }
  async listSubscriptionsPaymentPending(): Promise<BillingSubscription[]> {
    return [...this.t.subscriptions.values()].filter((s) => s.status === "payment_pending");
  }
  async listSubscriptionsByStatus(status: SubscriptionStatus): Promise<BillingSubscription[]> {
    return [...this.t.subscriptions.values()].filter((s) => s.status === status);
  }

  // ---- Invoices ----
  async createInvoice(input: Omit<BillingInvoice, "id" | "createdAt" | "updatedAt">): Promise<BillingInvoice> {
    const now = this.now();
    const rec: BillingInvoice = { ...input, id: this.id("inv"), createdAt: now, updatedAt: now };
    this.t.invoices.set(rec.id, rec);
    return rec;
  }
  async getInvoice(id: string): Promise<BillingInvoice | undefined> {
    return this.t.invoices.get(id);
  }
  async updateInvoice(id: string, patch: Partial<Omit<BillingInvoice, "id" | "createdAt">>): Promise<BillingInvoice> {
    const existing = this.t.invoices.get(id);
    if (!existing) throw notFound("Invoice", id);
    const updated: BillingInvoice = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.invoices.set(id, updated);
    return updated;
  }
  async listInvoicesBySubscription(subscriptionId: string): Promise<BillingInvoice[]> {
    return [...this.t.invoices.values()]
      .filter((i) => i.subscriptionId === subscriptionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // ---- Invoice lines ----
  async createInvoiceLines(lines: Array<Omit<BillingInvoiceLine, "id" | "createdAt" | "updatedAt">>): Promise<BillingInvoiceLine[]> {
    const now = this.now();
    const out: BillingInvoiceLine[] = [];
    for (const input of lines) {
      const rec: BillingInvoiceLine = { ...input, id: this.id("line"), createdAt: now, updatedAt: now };
      this.t.invoiceLines.set(rec.id, rec);
      out.push(rec);
    }
    return out;
  }
  async listInvoiceLines(invoiceId: string): Promise<BillingInvoiceLine[]> {
    return [...this.t.invoiceLines.values()]
      .filter((l) => l.invoiceId === invoiceId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // ---- Charge attempts ----
  async createChargeAttempt(input: Omit<BillingChargeAttempt, "id" | "createdAt" | "updatedAt">): Promise<BillingChargeAttempt> {
    const now = this.now();
    if (await this.getChargeAttemptByIdempotencyKey(input.idempotencyKey)) {
      throw new BillingError("CONFLICT", `Charge attempt already exists for idempotency key ${input.idempotencyKey}`);
    }
    const rec: BillingChargeAttempt = { ...input, id: this.id("chg"), createdAt: now, updatedAt: now };
    this.t.chargeAttempts.set(rec.id, rec);
    return rec;
  }
  async getChargeAttempt(id: string): Promise<BillingChargeAttempt | undefined> {
    return this.t.chargeAttempts.get(id);
  }
  async getChargeAttemptByIdempotencyKey(idempotencyKey: string): Promise<BillingChargeAttempt | undefined> {
    for (const c of this.t.chargeAttempts.values()) {
      if (c.idempotencyKey === idempotencyKey) return c;
    }
    return undefined;
  }
  async getChargeAttemptByProviderPaymentId(providerPaymentId: string): Promise<BillingChargeAttempt | undefined> {
    for (const c of this.t.chargeAttempts.values()) {
      if (c.providerPaymentId === providerPaymentId) return c;
    }
    return undefined;
  }
  async updateChargeAttempt(id: string, patch: Partial<Omit<BillingChargeAttempt, "id" | "createdAt">>): Promise<BillingChargeAttempt> {
    const existing = this.t.chargeAttempts.get(id);
    if (!existing) throw notFound("ChargeAttempt", id);
    const updated: BillingChargeAttempt = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.chargeAttempts.set(id, updated);
    return updated;
  }
  async listChargeAttemptsByInvoice(invoiceId: string): Promise<BillingChargeAttempt[]> {
    return [...this.t.chargeAttempts.values()]
      .filter((c) => c.invoiceId === invoiceId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }
  async listChargeAttemptsBySubscription(subscriptionId: string): Promise<BillingChargeAttempt[]> {
    return [...this.t.chargeAttempts.values()]
      .filter((c) => c.subscriptionId === subscriptionId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }
  async listChargeAttemptsToRetry(before: Date): Promise<BillingChargeAttempt[]> {
    return [...this.t.chargeAttempts.values()].filter(
      (c) => c.status === "failed_retryable" && c.nextRetryAt != null && c.nextRetryAt.getTime() <= before.getTime()
    );
  }

  // ---- Discounts ----
  async upsertDiscount(input: Omit<BillingDiscount, "id" | "createdAt" | "updatedAt"> & { id: string }): Promise<BillingDiscount> {
    const now = this.now();
    const existing = this.t.discounts.get(input.id);
    const rec: BillingDiscount = { ...(existing ?? { createdAt: now }), ...input, updatedAt: now } as BillingDiscount;
    this.t.discounts.set(input.id, rec);
    return rec;
  }
  async getDiscount(id: string): Promise<BillingDiscount | undefined> {
    return this.t.discounts.get(id);
  }
  async getDiscountByCode(code: string): Promise<BillingDiscount | undefined> {
    const lower = code.trim().toLowerCase();
    for (const d of this.t.discounts.values()) {
      if (d.code.trim().toLowerCase() === lower) return d;
    }
    return undefined;
  }
  async listDiscounts(): Promise<BillingDiscount[]> {
    return [...this.t.discounts.values()];
  }
  async countDiscountRedemptions(discountId: string): Promise<number> {
    return [...this.t.redemptions.values()].filter((r) => r.discountId === discountId).length;
  }
  async listDiscountRedemptionsForSubscription(discountId: string, subscriptionId: string): Promise<BillingDiscountRedemption[]> {
    return [...this.t.redemptions.values()].filter((r) => r.discountId === discountId && r.subscriptionId === subscriptionId);
  }
  async createDiscountRedemption(input: Omit<BillingDiscountRedemption, "id" | "createdAt" | "updatedAt">): Promise<BillingDiscountRedemption> {
    const now = this.now();
    const rec: BillingDiscountRedemption = { ...input, id: this.id("rdmp"), createdAt: now, updatedAt: now };
    this.t.redemptions.set(rec.id, rec);
    return rec;
  }

  // ---- Webhooks ----
  async recordWebhookEventAttempt(input: Omit<BillingWebhookEvent, "id" | "createdAt" | "updatedAt">): Promise<{ inserted: boolean; record: BillingWebhookEvent }> {
    const existing = await this.getWebhookEvent(input.provider, input.providerEventId);
    if (existing) return { inserted: false, record: existing };
    const now = this.now();
    const rec: BillingWebhookEvent = { ...input, id: this.id("hook"), createdAt: now, updatedAt: now };
    this.t.webhooks.set(rec.id, rec);
    return { inserted: true, record: rec };
  }
  async getWebhookEvent(provider: ProviderName, providerEventId: string): Promise<BillingWebhookEvent | undefined> {
    for (const w of this.t.webhooks.values()) {
      if (w.provider === provider && w.providerEventId === providerEventId) return w;
    }
    return undefined;
  }
  async updateWebhookEvent(id: string, patch: Partial<Omit<BillingWebhookEvent, "id" | "createdAt">>): Promise<BillingWebhookEvent> {
    const existing = this.t.webhooks.get(id);
    if (!existing) throw notFound("WebhookEvent", id);
    const updated: BillingWebhookEvent = { ...existing, ...patch, id, updatedAt: this.now() };
    this.t.webhooks.set(id, updated);
    return updated;
  }
}
