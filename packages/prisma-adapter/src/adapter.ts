/**
 * Prisma storage adapter for {@link BillingStorage}. Mirrors the in-memory
 * adapter's semantics exactly: uniqueness/conflict behavior, idempotency,
 * list-query filters, and result ordering. Money is persisted as BigInt paise;
 * the mapper converts to/from domain `number`.
 */
import type { Clock, IdFactory } from "@questili/razorpay-recurring-upi";
import { systemClock, randomIdFactory } from "@questili/razorpay-recurring-upi";
import { BillingError, notFound } from "@questili/razorpay-recurring-upi";
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
  BillingWebhookEvent,
  BillingStorage,
  ProviderName,
  SubscriptionStatus
} from "@questili/razorpay-recurring-upi";

import * as mapper from "./mapper.js";

/**
 * Minimal structural view of `@prisma/client`. Declared locally so the adapter
 * typechecks without `prisma generate`. Each model's delegate mirrors the row
 * shapes in {@link mapper}. The real `PrismaClient` is structurally compatible.
 */
export interface PrismaClientLike {
  billingCustomer: PrismaModelDelegate<mapper.CustomerRow>;
  billingProviderCustomer: PrismaModelDelegate<mapper.ProviderCustomerRow>;
  billingMandate: PrismaModelDelegate<mapper.MandateRow>;
  billingPlan: PrismaModelDelegate<mapper.PlanRow>;
  billingSubscription: PrismaModelDelegate<mapper.SubscriptionRow>;
  billingInvoice: PrismaModelDelegate<mapper.InvoiceRow>;
  billingInvoiceLine: PrismaModelDelegate<mapper.InvoiceLineRow>;
  billingChargeAttempt: PrismaModelDelegate<mapper.ChargeAttemptRow>;
  billingDiscount: PrismaModelDelegate<mapper.DiscountRow>;
  billingDiscountRedemption: PrismaModelDelegate<mapper.DiscountRedemptionRow>;
  billingWebhookEvent: PrismaModelDelegate<mapper.WebhookEventRow>;
}

interface PrismaModelDelegate<Row> {
  create(args: { data: Record<string, unknown> }): Promise<Row>;
  findUnique(args: { where: Record<string, unknown> }): Promise<Row | null>;
  findFirst(args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }): Promise<Row | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
  }): Promise<Row[]>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Row>;
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<Row>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface PrismaStorageOptions {
  clock?: Clock;
  idFactory?: IdFactory;
}

/** Prisma's unique-constraint violation error code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Statuses considered "active" for entitlement purposes. */
const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "active",
  "past_due",
  "payment_pending",
  "reauthorization_required",
  "cancel_at_period_end",
  "pending_authorization"
];

export class PrismaBillingStorage implements BillingStorage {
  private readonly clock: Clock;
  private readonly id: IdFactory;

  constructor(
    private readonly prisma: PrismaClientLike,
    opts: PrismaStorageOptions = {}
  ) {
    this.clock = opts.clock ?? systemClock;
    this.id = opts.idFactory ?? randomIdFactory;
  }

  private now(): Date {
    return this.clock.now();
  }

  // ---- Customers ----

  async createCustomer(input: Omit<BillingCustomer, "id" | "createdAt" | "updatedAt">): Promise<BillingCustomer> {
    const now = this.now();
    const data = {
      ...mapper.customerToCreate(input),
      id: this.id("cust"),
      createdAt: now,
      updatedAt: now
    };
    const row = await this.prisma.billingCustomer.create({ data });
    return mapper.customerToRow(row);
  }

  async getCustomer(id: string): Promise<BillingCustomer | undefined> {
    const row = await this.prisma.billingCustomer.findUnique({ where: { id } });
    return row ? mapper.customerToRow(row) : undefined;
  }

  async getCustomerByExternalId(externalCustomerId: string): Promise<BillingCustomer | undefined> {
    const row = await this.prisma.billingCustomer.findFirst({ where: { externalCustomerId } });
    return row ? mapper.customerToRow(row) : undefined;
  }

  async updateCustomer(
    id: string,
    patch: Partial<Omit<BillingCustomer, "id" | "createdAt">>
  ): Promise<BillingCustomer> {
    const existing = await this.prisma.billingCustomer.findUnique({ where: { id } });
    if (!existing) throw notFound("Customer", id);
    const data = mapper.customerToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingCustomer.update({ where: { id }, data });
    return mapper.customerToRow(row);
  }

  // ---- Provider customers ----

  async createProviderCustomer(
    input: Omit<BillingProviderCustomer, "id" | "createdAt" | "updatedAt">
  ): Promise<BillingProviderCustomer> {
    // Idempotent on (provider, providerCustomerId): return existing if present.
    const existing = await this.prisma.billingProviderCustomer.findUnique({
      where: {
        provider_providerCustomerId: {
          provider: input.provider,
          providerCustomerId: input.providerCustomerId
        }
      }
    });
    if (existing) return mapper.providerCustomerToRow(existing);
    const now = this.now();
    const data = {
      ...mapper.providerCustomerToCreate(input),
      id: this.id("pcust"),
      createdAt: now,
      updatedAt: now
    };
    try {
      const row = await this.prisma.billingProviderCustomer.create({ data });
      return mapper.providerCustomerToRow(row);
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        const again = await this.prisma.billingProviderCustomer.findUnique({
          where: {
            provider_providerCustomerId: {
              provider: input.provider,
              providerCustomerId: input.providerCustomerId
            }
          }
        });
        if (again) return mapper.providerCustomerToRow(again);
      }
      throw e;
    }
  }

  async getProviderCustomer(
    provider: ProviderName,
    providerCustomerId: string
  ): Promise<BillingProviderCustomer | undefined> {
    const row = await this.prisma.billingProviderCustomer.findUnique({
      where: {
        provider_providerCustomerId: { provider, providerCustomerId }
      }
    });
    return row ? mapper.providerCustomerToRow(row) : undefined;
  }

  async listProviderCustomers(billingCustomerId: string): Promise<BillingProviderCustomer[]> {
    const rows = await this.prisma.billingProviderCustomer.findMany({
      where: { billingCustomerId }
    });
    return rows.map((r) => mapper.providerCustomerToRow(r));
  }

  // ---- Plans ----

  async upsertPlan(input: Omit<BillingPlan, "id" | "createdAt" | "updatedAt"> & { id: string }): Promise<BillingPlan> {
    const now = this.now();
    const fields = mapper.planToUpsert(input);
    const row = await this.prisma.billingPlan.upsert({
      where: { id: input.id },
      create: { ...fields, createdAt: now, updatedAt: now },
      update: { ...fields, updatedAt: now }
    });
    return mapper.planToRow(row);
  }

  async getPlan(id: string): Promise<BillingPlan | undefined> {
    const row = await this.prisma.billingPlan.findUnique({ where: { id } });
    return row ? mapper.planToRow(row) : undefined;
  }

  async listPlans(): Promise<BillingPlan[]> {
    const rows = await this.prisma.billingPlan.findMany({ where: {} });
    return rows.map((r) => mapper.planToRow(r));
  }

  // ---- Mandates ----

  async createMandate(input: Omit<BillingMandate, "id" | "createdAt" | "updatedAt">): Promise<BillingMandate> {
    if (input.providerTokenId) {
      const dup = await this.getMandateByToken(input.provider, input.providerTokenId);
      if (dup) {
        throw new BillingError("CONFLICT", `Mandate already exists for token ${input.providerTokenId}`);
      }
    }
    const now = this.now();
    const data = {
      ...mapper.mandateToCreate(input),
      id: this.id("mand"),
      createdAt: now,
      updatedAt: now
    };
    try {
      const row = await this.prisma.billingMandate.create({ data });
      return mapper.mandateToRow(row);
    } catch (e) {
      if (isPrismaUniqueViolation(e) && input.providerTokenId) {
        throw new BillingError("CONFLICT", `Mandate already exists for token ${input.providerTokenId}`);
      }
      throw e;
    }
  }

  async getMandate(id: string): Promise<BillingMandate | undefined> {
    const row = await this.prisma.billingMandate.findUnique({ where: { id } });
    return row ? mapper.mandateToRow(row) : undefined;
  }

  async getMandateByToken(provider: ProviderName, providerTokenId: string): Promise<BillingMandate | undefined> {
    const row = await this.prisma.billingMandate.findUnique({
      where: { provider_providerTokenId: { provider, providerTokenId } }
    });
    return row ? mapper.mandateToRow(row) : undefined;
  }

  async getMandateByAuthorizationPaymentId(providerPaymentId: string): Promise<BillingMandate | undefined> {
    const row = await this.prisma.billingMandate.findFirst({
      where: { authorizationPaymentId: providerPaymentId }
    });
    return row ? mapper.mandateToRow(row) : undefined;
  }

  async updateMandate(id: string, patch: Partial<Omit<BillingMandate, "id" | "createdAt">>): Promise<BillingMandate> {
    const existing = await this.prisma.billingMandate.findUnique({ where: { id } });
    if (!existing) throw notFound("Mandate", id);
    const data = mapper.mandateToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingMandate.update({ where: { id }, data });
    return mapper.mandateToRow(row);
  }

  async listMandatesByCustomer(billingCustomerId: string): Promise<BillingMandate[]> {
    const rows = await this.prisma.billingMandate.findMany({ where: { billingCustomerId } });
    return rows.map((r) => mapper.mandateToRow(r));
  }

  // ---- Subscriptions ----

  async createSubscription(
    input: Omit<BillingSubscription, "id" | "createdAt" | "updatedAt">
  ): Promise<BillingSubscription> {
    const now = this.now();
    const data = {
      ...mapper.subscriptionToCreate(input),
      id: this.id("sub"),
      createdAt: now,
      updatedAt: now
    };
    const row = await this.prisma.billingSubscription.create({ data });
    return mapper.subscriptionToRow(row);
  }

  async getSubscription(id: string): Promise<BillingSubscription | undefined> {
    const row = await this.prisma.billingSubscription.findUnique({ where: { id } });
    return row ? mapper.subscriptionToRow(row) : undefined;
  }

  async getActiveSubscriptionByCustomer(billingCustomerId: string): Promise<BillingSubscription | undefined> {
    const row = await this.prisma.billingSubscription.findFirst({
      where: { billingCustomerId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } }
    });
    return row ? mapper.subscriptionToRow(row) : undefined;
  }

  async updateSubscription(
    id: string,
    patch: Partial<Omit<BillingSubscription, "id" | "createdAt">>
  ): Promise<BillingSubscription> {
    const existing = await this.prisma.billingSubscription.findUnique({ where: { id } });
    if (!existing) throw notFound("Subscription", id);
    const data = mapper.subscriptionToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingSubscription.update({ where: { id }, data });
    return mapper.subscriptionToRow(row);
  }

  async listSubscriptionsDueForRenewal(before: Date): Promise<BillingSubscription[]> {
    const rows = await this.prisma.billingSubscription.findMany({
      where: { status: "active", nextBillingAt: { not: null, lte: before } }
    });
    return rows.map((r) => mapper.subscriptionToRow(r));
  }

  async listSubscriptionsPastDue(): Promise<BillingSubscription[]> {
    const rows = await this.prisma.billingSubscription.findMany({ where: { status: "past_due" } });
    return rows.map((r) => mapper.subscriptionToRow(r));
  }

  async listSubscriptionsPaymentPending(): Promise<BillingSubscription[]> {
    const rows = await this.prisma.billingSubscription.findMany({ where: { status: "payment_pending" } });
    return rows.map((r) => mapper.subscriptionToRow(r));
  }

  async listSubscriptionsByStatus(status: SubscriptionStatus): Promise<BillingSubscription[]> {
    const rows = await this.prisma.billingSubscription.findMany({ where: { status } });
    return rows.map((r) => mapper.subscriptionToRow(r));
  }

  // ---- Invoices ----

  async createInvoice(input: Omit<BillingInvoice, "id" | "createdAt" | "updatedAt">): Promise<BillingInvoice> {
    const now = this.now();
    const data = {
      ...mapper.invoiceToCreate(input),
      id: this.id("inv"),
      createdAt: now,
      updatedAt: now
    };
    const row = await this.prisma.billingInvoice.create({ data });
    return mapper.invoiceToRow(row);
  }

  async getInvoice(id: string): Promise<BillingInvoice | undefined> {
    const row = await this.prisma.billingInvoice.findUnique({ where: { id } });
    return row ? mapper.invoiceToRow(row) : undefined;
  }

  async updateInvoice(id: string, patch: Partial<Omit<BillingInvoice, "id" | "createdAt">>): Promise<BillingInvoice> {
    const existing = await this.prisma.billingInvoice.findUnique({ where: { id } });
    if (!existing) throw notFound("Invoice", id);
    const data = mapper.invoiceToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingInvoice.update({ where: { id }, data });
    return mapper.invoiceToRow(row);
  }

  async listInvoicesBySubscription(subscriptionId: string): Promise<BillingInvoice[]> {
    // Newest first, matching the in-memory adapter.
    const rows = await this.prisma.billingInvoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map((r) => mapper.invoiceToRow(r));
  }

  // ---- Invoice lines ----

  async createInvoiceLines(
    lines: Array<Omit<BillingInvoiceLine, "id" | "createdAt" | "updatedAt">>
  ): Promise<BillingInvoiceLine[]> {
    const now = this.now();
    const out: BillingInvoiceLine[] = [];
    for (const input of lines) {
      const data = {
        ...mapper.invoiceLineToCreate(input),
        id: this.id("line"),
        createdAt: now,
        updatedAt: now
      };
      const row = await this.prisma.billingInvoiceLine.create({ data });
      out.push(mapper.invoiceLineToRow(row));
    }
    return out;
  }

  async listInvoiceLines(invoiceId: string): Promise<BillingInvoiceLine[]> {
    // Oldest first, matching the in-memory adapter.
    const rows = await this.prisma.billingInvoiceLine.findMany({
      where: { invoiceId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((r) => mapper.invoiceLineToRow(r));
  }

  // ---- Charge attempts ----

  async createChargeAttempt(
    input: Omit<BillingChargeAttempt, "id" | "createdAt" | "updatedAt">
  ): Promise<BillingChargeAttempt> {
    if (await this.getChargeAttemptByIdempotencyKey(input.idempotencyKey)) {
      throw new BillingError("CONFLICT", `Charge attempt already exists for idempotency key ${input.idempotencyKey}`);
    }
    const now = this.now();
    const data = {
      ...mapper.chargeAttemptToCreate(input),
      id: this.id("chg"),
      createdAt: now,
      updatedAt: now
    };
    try {
      const row = await this.prisma.billingChargeAttempt.create({ data });
      return mapper.chargeAttemptToRow(row);
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        throw new BillingError("CONFLICT", `Charge attempt already exists for idempotency key ${input.idempotencyKey}`);
      }
      throw e;
    }
  }

  async getChargeAttempt(id: string): Promise<BillingChargeAttempt | undefined> {
    const row = await this.prisma.billingChargeAttempt.findUnique({ where: { id } });
    return row ? mapper.chargeAttemptToRow(row) : undefined;
  }

  async getChargeAttemptByIdempotencyKey(idempotencyKey: string): Promise<BillingChargeAttempt | undefined> {
    const row = await this.prisma.billingChargeAttempt.findUnique({ where: { idempotencyKey } });
    return row ? mapper.chargeAttemptToRow(row) : undefined;
  }

  async getChargeAttemptByProviderPaymentId(providerPaymentId: string): Promise<BillingChargeAttempt | undefined> {
    const row = await this.prisma.billingChargeAttempt.findFirst({ where: { providerPaymentId } });
    return row ? mapper.chargeAttemptToRow(row) : undefined;
  }

  async updateChargeAttempt(
    id: string,
    patch: Partial<Omit<BillingChargeAttempt, "id" | "createdAt">>
  ): Promise<BillingChargeAttempt> {
    const existing = await this.prisma.billingChargeAttempt.findUnique({ where: { id } });
    if (!existing) throw notFound("ChargeAttempt", id);
    const data = mapper.chargeAttemptToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingChargeAttempt.update({ where: { id }, data });
    return mapper.chargeAttemptToRow(row);
  }

  async listChargeAttemptsByInvoice(invoiceId: string): Promise<BillingChargeAttempt[]> {
    // Earliest attempt first, matching the in-memory adapter.
    const rows = await this.prisma.billingChargeAttempt.findMany({
      where: { invoiceId },
      orderBy: { attemptNumber: "asc" }
    });
    return rows.map((r) => mapper.chargeAttemptToRow(r));
  }

  async listChargeAttemptsBySubscription(subscriptionId: string): Promise<BillingChargeAttempt[]> {
    const rows = await this.prisma.billingChargeAttempt.findMany({
      where: { subscriptionId },
      orderBy: { attemptNumber: "asc" }
    });
    return rows.map((r) => mapper.chargeAttemptToRow(r));
  }

  async listChargeAttemptsToRetry(before: Date): Promise<BillingChargeAttempt[]> {
    const rows = await this.prisma.billingChargeAttempt.findMany({
      where: { status: "failed_retryable", nextRetryAt: { not: null, lte: before } }
    });
    return rows.map((r) => mapper.chargeAttemptToRow(r));
  }

  // ---- Discounts ----

  async upsertDiscount(
    input: Omit<BillingDiscount, "id" | "createdAt" | "updatedAt"> & { id: string }
  ): Promise<BillingDiscount> {
    const now = this.now();
    const fields = mapper.discountToUpsert(input);
    const row = await this.prisma.billingDiscount.upsert({
      where: { id: input.id },
      create: { ...fields, createdAt: now, updatedAt: now },
      update: { ...fields, updatedAt: now }
    });
    return mapper.discountToRow(row);
  }

  async getDiscount(id: string): Promise<BillingDiscount | undefined> {
    const row = await this.prisma.billingDiscount.findUnique({ where: { id } });
    return row ? mapper.discountToRow(row) : undefined;
  }

  async getDiscountByCode(code: string): Promise<BillingDiscount | undefined> {
    // Case-insensitive, trimmed lookup (matches in-memory semantics). PostgreSQL
    // `equals` with `mode: "insensitive"` is the natural equivalent.
    const normalized = code.trim().toLowerCase();
    const rows = await this.prisma.billingDiscount.findMany({ where: {} });
    const match = rows.find((r) => r.code.trim().toLowerCase() === normalized);
    return match ? mapper.discountToRow(match) : undefined;
  }

  async listDiscounts(): Promise<BillingDiscount[]> {
    const rows = await this.prisma.billingDiscount.findMany({ where: {} });
    return rows.map((r) => mapper.discountToRow(r));
  }

  async countDiscountRedemptions(discountId: string): Promise<number> {
    return this.prisma.billingDiscountRedemption.count({ where: { discountId } });
  }

  async listDiscountRedemptionsForSubscription(
    discountId: string,
    subscriptionId: string
  ): Promise<BillingDiscountRedemption[]> {
    const rows = await this.prisma.billingDiscountRedemption.findMany({
      where: { discountId, subscriptionId }
    });
    return rows.map((r) => mapper.discountRedemptionToRow(r));
  }

  async createDiscountRedemption(
    input: Omit<BillingDiscountRedemption, "id" | "createdAt" | "updatedAt">
  ): Promise<BillingDiscountRedemption> {
    const now = this.now();
    const data = {
      ...mapper.discountRedemptionToCreate(input),
      id: this.id("rdmp"),
      createdAt: now,
      updatedAt: now
    };
    const row = await this.prisma.billingDiscountRedemption.create({ data });
    return mapper.discountRedemptionToRow(row);
  }

  // ---- Webhooks ----

  async recordWebhookEventAttempt(
    input: Omit<BillingWebhookEvent, "id" | "createdAt" | "updatedAt">
  ): Promise<{ inserted: boolean; record: BillingWebhookEvent }> {
    const now = this.now();
    const data = {
      ...mapper.webhookEventToCreate(input),
      id: this.id("hook"),
      createdAt: now,
      updatedAt: now
    };
    try {
      const row = await this.prisma.billingWebhookEvent.create({ data });
      return { inserted: true, record: mapper.webhookEventToRow(row) };
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        const existing = await this.prisma.billingWebhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: input.provider,
              providerEventId: input.providerEventId
            }
          }
        });
        if (existing) return { inserted: false, record: mapper.webhookEventToRow(existing) };
      }
      throw e;
    }
  }

  async getWebhookEvent(provider: ProviderName, providerEventId: string): Promise<BillingWebhookEvent | undefined> {
    const row = await this.prisma.billingWebhookEvent.findUnique({
      where: { provider_providerEventId: { provider, providerEventId } }
    });
    return row ? mapper.webhookEventToRow(row) : undefined;
  }

  async updateWebhookEvent(
    id: string,
    patch: Partial<Omit<BillingWebhookEvent, "id" | "createdAt">>
  ): Promise<BillingWebhookEvent> {
    const existing = await this.prisma.billingWebhookEvent.findUnique({ where: { id } });
    if (!existing) throw notFound("WebhookEvent", id);
    const data = mapper.webhookEventToUpdate(patch);
    data.updatedAt = this.now();
    const row = await this.prisma.billingWebhookEvent.update({ where: { id }, data });
    return mapper.webhookEventToRow(row);
  }
}

/** True when `e` is Prisma's known unique-constraint error (P2002). */
function isPrismaUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === PRISMA_UNIQUE_VIOLATION;
}
