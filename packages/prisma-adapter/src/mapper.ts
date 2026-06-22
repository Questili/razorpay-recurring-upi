/**
 * Pure mapping between Prisma rows and storage-neutral domain records.
 *
 * Conversions:
 *  - Money (integer paise): domain `number` <-> Prisma `BigInt`. Billing
 *    magnitudes are far below 2^53, so `Number()` is lossless.
 *  - JSON-ish fields (metadata, providerMetadata, features, appliesToPlanIds):
 *    domain objects/arrays <-> Prisma `Json`.
 *  - Status enums: domain string-literal unions <-> Prisma enum (also a string
 *    at the driver level), so they pass through unchanged.
 *  - Nullable domain fields map to optional Prisma fields.
 *
 * Row shapes are declared locally (not imported from `@prisma/client`) so this
 * file typechecks without running `prisma generate`. The generated client rows
 * are structurally identical.
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
} from "@questili/razorpay-recurring-upi";

/** Prisma `Json` value. */
export type Json = unknown;

/** Common persisted columns. */
export interface BaseRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerRow extends BaseRow {
  externalCustomerId: string;
  email: string | null;
  name: string | null;
  contact: string | null;
}

export interface ProviderCustomerRow extends BaseRow {
  billingCustomerId: string;
  provider: string;
  providerCustomerId: string;
  metadata: Json;
}

export interface MandateRow extends BaseRow {
  billingCustomerId: string;
  provider: string;
  providerCustomerId: string;
  providerTokenId: string | null;
  authorizationPaymentId: string | null;
  authorizationOrderId: string | null;
  method: string;
  status: string;
  currency: string;
  maxAmount: bigint;
  frequency: string | null;
  expiresAt: Date | null;
  safeInstrumentLabel: string | null;
  providerMetadata: Json;
}

export interface PlanRow extends BaseRow {
  name: string;
  interval: string;
  currency: string;
  amount: bigint;
  active: boolean;
  features: Json;
  metadata: Json;
}

export interface SubscriptionRow extends BaseRow {
  billingCustomerId: string;
  mandateId: string | null;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  nextBillingAt: Date | null;
  accessEndsAt: Date;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  pendingPlanId: string | null;
  pendingPlanEffectiveAt: Date | null;
  trialEndsAt: Date | null;
  metadata: Json;
}

export interface InvoiceRow extends BaseRow {
  subscriptionId: string;
  customerId: string;
  status: string;
  reason: string;
  currency: string;
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  total: bigint;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  paidAt: Date | null;
  metadata: Json;
}

export interface InvoiceLineRow extends BaseRow {
  invoiceId: string;
  type: string;
  description: string;
  quantity: number;
  unitAmount: bigint;
  amount: bigint;
  periodStart: Date;
  periodEnd: Date;
  metadata: Json;
}

export interface ChargeAttemptRow extends BaseRow {
  invoiceId: string;
  subscriptionId: string;
  mandateId: string;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: string;
  amount: bigint;
  currency: string;
  failureClass: string | null;
  failureCode: string | null;
  failureReason: string | null;
  nextRetryAt: Date | null;
  attemptNumber: number;
  idempotencyKey: string;
  providerRequestRef: string | null;
}

export interface DiscountRow extends BaseRow {
  code: string;
  type: string;
  value: bigint;
  duration: string;
  durationInCycles: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  maxRedemptions: number | null;
  active: boolean;
  appliesToPlanIds: Json;
  metadata: Json;
}

export interface DiscountRedemptionRow extends BaseRow {
  discountId: string;
  customerId: string;
  subscriptionId: string | null;
  invoiceId: string | null;
  redeemedAt: Date;
}

export interface WebhookEventRow extends BaseRow {
  provider: string;
  providerEventId: string;
  eventType: string;
  processedAt: Date | null;
  status: string;
  payloadHash: string;
  error: string | null;
}

/** Coerce a Prisma `Json` to a plain object record (defaults to empty record). */
function asObject(value: Json): Record<string, unknown> {
  return (value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}) as Record<string, unknown>;
}

/** Coerce a Prisma `Json` known to be a string array (defaults to empty array). */
function asStringArray(value: Json): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

// ---- Customer ----

export function customerToRow(r: CustomerRow): BillingCustomer {
  return {
    id: r.id,
    externalCustomerId: r.externalCustomerId,
    email: r.email,
    name: r.name,
    contact: r.contact,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function customerToCreate(
  input: Omit<BillingCustomer, "id" | "createdAt" | "updatedAt">
): Omit<CustomerRow, "id" | "createdAt" | "updatedAt"> {
  return {
    externalCustomerId: input.externalCustomerId,
    email: input.email,
    name: input.name,
    contact: input.contact
  };
}

export function customerToUpdate(
  patch: Partial<Omit<BillingCustomer, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.externalCustomerId !== undefined) data.externalCustomerId = patch.externalCustomerId;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.contact !== undefined) data.contact = patch.contact;
  return data;
}

// ---- Provider customer ----

export function providerCustomerToRow(r: ProviderCustomerRow): BillingProviderCustomer {
  return {
    id: r.id,
    billingCustomerId: r.billingCustomerId,
    provider: r.provider as BillingProviderCustomer["provider"],
    providerCustomerId: r.providerCustomerId,
    metadata: asObject(r.metadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function providerCustomerToCreate(
  input: Omit<BillingProviderCustomer, "id" | "createdAt" | "updatedAt">
): Omit<ProviderCustomerRow, "id" | "createdAt" | "updatedAt"> {
  return {
    billingCustomerId: input.billingCustomerId,
    provider: input.provider,
    providerCustomerId: input.providerCustomerId,
    metadata: input.metadata ?? {}
  };
}

// ---- Mandate ----

export function mandateToRow(r: MandateRow): BillingMandate {
  return {
    id: r.id,
    billingCustomerId: r.billingCustomerId,
    provider: r.provider as BillingMandate["provider"],
    providerCustomerId: r.providerCustomerId,
    providerTokenId: r.providerTokenId,
    authorizationPaymentId: r.authorizationPaymentId,
    authorizationOrderId: r.authorizationOrderId,
    method: r.method as BillingMandate["method"],
    status: r.status as BillingMandate["status"],
    currency: r.currency as BillingMandate["currency"],
    maxAmount: Number(r.maxAmount),
    frequency: r.frequency,
    expiresAt: r.expiresAt,
    safeInstrumentLabel: r.safeInstrumentLabel,
    providerMetadata: asObject(r.providerMetadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function mandateToCreate(
  input: Omit<BillingMandate, "id" | "createdAt" | "updatedAt">
): Omit<MandateRow, "id" | "createdAt" | "updatedAt"> {
  return {
    billingCustomerId: input.billingCustomerId,
    provider: input.provider,
    providerCustomerId: input.providerCustomerId,
    providerTokenId: input.providerTokenId,
    authorizationPaymentId: input.authorizationPaymentId,
    authorizationOrderId: input.authorizationOrderId,
    method: input.method,
    status: input.status,
    currency: input.currency,
    maxAmount: BigInt(input.maxAmount),
    frequency: input.frequency,
    expiresAt: input.expiresAt,
    safeInstrumentLabel: input.safeInstrumentLabel,
    providerMetadata: input.providerMetadata ?? {}
  };
}

export function mandateToUpdate(
  patch: Partial<Omit<BillingMandate, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.billingCustomerId !== undefined) data.billingCustomerId = patch.billingCustomerId;
  if (patch.provider !== undefined) data.provider = patch.provider;
  if (patch.providerCustomerId !== undefined) data.providerCustomerId = patch.providerCustomerId;
  if (patch.providerTokenId !== undefined) data.providerTokenId = patch.providerTokenId;
  if (patch.authorizationPaymentId !== undefined) data.authorizationPaymentId = patch.authorizationPaymentId;
  if (patch.authorizationOrderId !== undefined) data.authorizationOrderId = patch.authorizationOrderId;
  if (patch.method !== undefined) data.method = patch.method;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.maxAmount !== undefined) data.maxAmount = BigInt(patch.maxAmount);
  if (patch.frequency !== undefined) data.frequency = patch.frequency;
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
  if (patch.safeInstrumentLabel !== undefined) data.safeInstrumentLabel = patch.safeInstrumentLabel;
  if (patch.providerMetadata !== undefined) data.providerMetadata = patch.providerMetadata ?? {};
  return data;
}

// ---- Plan ----

export function planToRow(r: PlanRow): BillingPlan {
  return {
    id: r.id,
    name: r.name,
    interval: r.interval as BillingPlan["interval"],
    currency: r.currency as BillingPlan["currency"],
    amount: Number(r.amount),
    active: r.active,
    features: asStringArray(r.features),
    metadata: asObject(r.metadata) as Record<string, string>,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function planToUpsert(
  input: Omit<BillingPlan, "id" | "createdAt" | "updatedAt"> & { id: string }
): Omit<PlanRow, "createdAt" | "updatedAt"> & { id: string } {
  return {
    id: input.id,
    name: input.name,
    interval: input.interval,
    currency: input.currency,
    amount: BigInt(input.amount),
    active: input.active,
    features: input.features ?? [],
    metadata: input.metadata ?? {}
  };
}

// ---- Subscription ----

export function subscriptionToRow(r: SubscriptionRow): BillingSubscription {
  return {
    id: r.id,
    billingCustomerId: r.billingCustomerId,
    mandateId: r.mandateId,
    planId: r.planId,
    status: r.status as BillingSubscription["status"],
    currentPeriodStart: r.currentPeriodStart,
    currentPeriodEnd: r.currentPeriodEnd,
    nextBillingAt: r.nextBillingAt,
    accessEndsAt: r.accessEndsAt,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    cancellationRequestedAt: r.cancellationRequestedAt,
    canceledAt: r.canceledAt,
    cancelReason: r.cancelReason as BillingSubscription["cancelReason"],
    pendingPlanId: r.pendingPlanId,
    pendingPlanEffectiveAt: r.pendingPlanEffectiveAt,
    trialEndsAt: r.trialEndsAt,
    metadata: asObject(r.metadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function subscriptionToCreate(
  input: Omit<BillingSubscription, "id" | "createdAt" | "updatedAt">
): Omit<SubscriptionRow, "id" | "createdAt" | "updatedAt"> {
  return {
    billingCustomerId: input.billingCustomerId,
    mandateId: input.mandateId,
    planId: input.planId,
    status: input.status,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    nextBillingAt: input.nextBillingAt,
    accessEndsAt: input.accessEndsAt,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    cancellationRequestedAt: input.cancellationRequestedAt,
    canceledAt: input.canceledAt,
    cancelReason: input.cancelReason,
    pendingPlanId: input.pendingPlanId,
    pendingPlanEffectiveAt: input.pendingPlanEffectiveAt,
    trialEndsAt: input.trialEndsAt,
    metadata: input.metadata ?? {}
  };
}

export function subscriptionToUpdate(
  patch: Partial<Omit<BillingSubscription, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.billingCustomerId !== undefined) data.billingCustomerId = patch.billingCustomerId;
  if (patch.mandateId !== undefined) data.mandateId = patch.mandateId;
  if (patch.planId !== undefined) data.planId = patch.planId;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.currentPeriodStart !== undefined) data.currentPeriodStart = patch.currentPeriodStart;
  if (patch.currentPeriodEnd !== undefined) data.currentPeriodEnd = patch.currentPeriodEnd;
  if (patch.nextBillingAt !== undefined) data.nextBillingAt = patch.nextBillingAt;
  if (patch.accessEndsAt !== undefined) data.accessEndsAt = patch.accessEndsAt;
  if (patch.cancelAtPeriodEnd !== undefined) data.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
  if (patch.cancellationRequestedAt !== undefined) data.cancellationRequestedAt = patch.cancellationRequestedAt;
  if (patch.canceledAt !== undefined) data.canceledAt = patch.canceledAt;
  if (patch.cancelReason !== undefined) data.cancelReason = patch.cancelReason;
  if (patch.pendingPlanId !== undefined) data.pendingPlanId = patch.pendingPlanId;
  if (patch.pendingPlanEffectiveAt !== undefined) data.pendingPlanEffectiveAt = patch.pendingPlanEffectiveAt;
  if (patch.trialEndsAt !== undefined) data.trialEndsAt = patch.trialEndsAt;
  if (patch.metadata !== undefined) data.metadata = patch.metadata ?? {};
  return data;
}

// ---- Invoice ----

export function invoiceToRow(r: InvoiceRow): BillingInvoice {
  return {
    id: r.id,
    subscriptionId: r.subscriptionId,
    customerId: r.customerId,
    status: r.status as BillingInvoice["status"],
    reason: r.reason as BillingInvoice["reason"],
    currency: r.currency as BillingInvoice["currency"],
    subtotal: Number(r.subtotal),
    discountTotal: Number(r.discountTotal),
    taxTotal: Number(r.taxTotal),
    total: Number(r.total),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    dueAt: r.dueAt,
    paidAt: r.paidAt,
    metadata: asObject(r.metadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function invoiceToCreate(
  input: Omit<BillingInvoice, "id" | "createdAt" | "updatedAt">
): Omit<InvoiceRow, "id" | "createdAt" | "updatedAt"> {
  return {
    subscriptionId: input.subscriptionId,
    customerId: input.customerId,
    status: input.status,
    reason: input.reason,
    currency: input.currency,
    subtotal: BigInt(input.subtotal),
    discountTotal: BigInt(input.discountTotal),
    taxTotal: BigInt(input.taxTotal),
    total: BigInt(input.total),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueAt: input.dueAt,
    paidAt: input.paidAt,
    metadata: input.metadata ?? {}
  };
}

export function invoiceToUpdate(
  patch: Partial<Omit<BillingInvoice, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.subscriptionId !== undefined) data.subscriptionId = patch.subscriptionId;
  if (patch.customerId !== undefined) data.customerId = patch.customerId;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.reason !== undefined) data.reason = patch.reason;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.subtotal !== undefined) data.subtotal = BigInt(patch.subtotal);
  if (patch.discountTotal !== undefined) data.discountTotal = BigInt(patch.discountTotal);
  if (patch.taxTotal !== undefined) data.taxTotal = BigInt(patch.taxTotal);
  if (patch.total !== undefined) data.total = BigInt(patch.total);
  if (patch.periodStart !== undefined) data.periodStart = patch.periodStart;
  if (patch.periodEnd !== undefined) data.periodEnd = patch.periodEnd;
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt;
  if (patch.paidAt !== undefined) data.paidAt = patch.paidAt;
  if (patch.metadata !== undefined) data.metadata = patch.metadata ?? {};
  return data;
}

// ---- Invoice line ----

export function invoiceLineToRow(r: InvoiceLineRow): BillingInvoiceLine {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    type: r.type as BillingInvoiceLine["type"],
    description: r.description,
    quantity: r.quantity,
    unitAmount: Number(r.unitAmount),
    amount: Number(r.amount),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    metadata: asObject(r.metadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function invoiceLineToCreate(
  input: Omit<BillingInvoiceLine, "id" | "createdAt" | "updatedAt">
): Omit<InvoiceLineRow, "id" | "createdAt" | "updatedAt"> {
  return {
    invoiceId: input.invoiceId,
    type: input.type,
    description: input.description,
    quantity: input.quantity,
    unitAmount: BigInt(input.unitAmount),
    amount: BigInt(input.amount),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    metadata: input.metadata ?? {}
  };
}

// ---- Charge attempt ----

export function chargeAttemptToRow(r: ChargeAttemptRow): BillingChargeAttempt {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    subscriptionId: r.subscriptionId,
    mandateId: r.mandateId,
    provider: r.provider as BillingChargeAttempt["provider"],
    providerOrderId: r.providerOrderId,
    providerPaymentId: r.providerPaymentId,
    status: r.status as BillingChargeAttempt["status"],
    amount: Number(r.amount),
    currency: r.currency as BillingChargeAttempt["currency"],
    failureClass: r.failureClass as BillingChargeAttempt["failureClass"],
    failureCode: r.failureCode,
    failureReason: r.failureReason,
    nextRetryAt: r.nextRetryAt,
    attemptNumber: r.attemptNumber,
    idempotencyKey: r.idempotencyKey,
    providerRequestRef: r.providerRequestRef,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function chargeAttemptToCreate(
  input: Omit<BillingChargeAttempt, "id" | "createdAt" | "updatedAt">
): Omit<ChargeAttemptRow, "id" | "createdAt" | "updatedAt"> {
  return {
    invoiceId: input.invoiceId,
    subscriptionId: input.subscriptionId,
    mandateId: input.mandateId,
    provider: input.provider,
    providerOrderId: input.providerOrderId,
    providerPaymentId: input.providerPaymentId,
    status: input.status,
    amount: BigInt(input.amount),
    currency: input.currency,
    failureClass: input.failureClass,
    failureCode: input.failureCode,
    failureReason: input.failureReason,
    nextRetryAt: input.nextRetryAt,
    attemptNumber: input.attemptNumber,
    idempotencyKey: input.idempotencyKey,
    providerRequestRef: input.providerRequestRef
  };
}

export function chargeAttemptToUpdate(
  patch: Partial<Omit<BillingChargeAttempt, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.invoiceId !== undefined) data.invoiceId = patch.invoiceId;
  if (patch.subscriptionId !== undefined) data.subscriptionId = patch.subscriptionId;
  if (patch.mandateId !== undefined) data.mandateId = patch.mandateId;
  if (patch.provider !== undefined) data.provider = patch.provider;
  if (patch.providerOrderId !== undefined) data.providerOrderId = patch.providerOrderId;
  if (patch.providerPaymentId !== undefined) data.providerPaymentId = patch.providerPaymentId;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.amount !== undefined) data.amount = BigInt(patch.amount);
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.failureClass !== undefined) data.failureClass = patch.failureClass;
  if (patch.failureCode !== undefined) data.failureCode = patch.failureCode;
  if (patch.failureReason !== undefined) data.failureReason = patch.failureReason;
  if (patch.nextRetryAt !== undefined) data.nextRetryAt = patch.nextRetryAt;
  if (patch.attemptNumber !== undefined) data.attemptNumber = patch.attemptNumber;
  if (patch.idempotencyKey !== undefined) data.idempotencyKey = patch.idempotencyKey;
  if (patch.providerRequestRef !== undefined) data.providerRequestRef = patch.providerRequestRef;
  return data;
}

// ---- Discount ----

export function discountToRow(r: DiscountRow): BillingDiscount {
  return {
    id: r.id,
    code: r.code,
    type: r.type as BillingDiscount["type"],
    value: Number(r.value),
    duration: r.duration as BillingDiscount["duration"],
    durationInCycles: r.durationInCycles,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
    maxRedemptions: r.maxRedemptions,
    active: r.active,
    appliesToPlanIds: Array.isArray(r.appliesToPlanIds) ? (r.appliesToPlanIds as string[]) : null,
    metadata: asObject(r.metadata),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function discountToUpsert(
  input: Omit<BillingDiscount, "id" | "createdAt" | "updatedAt"> & { id: string }
): Omit<DiscountRow, "createdAt" | "updatedAt"> & { id: string } {
  return {
    id: input.id,
    code: input.code,
    type: input.type,
    value: BigInt(input.value),
    duration: input.duration,
    durationInCycles: input.durationInCycles,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    maxRedemptions: input.maxRedemptions,
    active: input.active,
    appliesToPlanIds: input.appliesToPlanIds,
    metadata: input.metadata ?? {}
  };
}

// ---- Discount redemption ----

export function discountRedemptionToRow(r: DiscountRedemptionRow): BillingDiscountRedemption {
  return {
    id: r.id,
    discountId: r.discountId,
    customerId: r.customerId,
    subscriptionId: r.subscriptionId,
    invoiceId: r.invoiceId,
    redeemedAt: r.redeemedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function discountRedemptionToCreate(
  input: Omit<BillingDiscountRedemption, "id" | "createdAt" | "updatedAt">
): Omit<DiscountRedemptionRow, "id" | "createdAt" | "updatedAt"> {
  return {
    discountId: input.discountId,
    customerId: input.customerId,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    redeemedAt: input.redeemedAt
  };
}

// ---- Webhook event ----

export function webhookEventToRow(r: WebhookEventRow): BillingWebhookEvent {
  return {
    id: r.id,
    provider: r.provider as BillingWebhookEvent["provider"],
    providerEventId: r.providerEventId,
    eventType: r.eventType,
    processedAt: r.processedAt,
    status: r.status as BillingWebhookEvent["status"],
    payloadHash: r.payloadHash,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function webhookEventToCreate(
  input: Omit<BillingWebhookEvent, "id" | "createdAt" | "updatedAt">
): Omit<WebhookEventRow, "id" | "createdAt" | "updatedAt"> {
  return {
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    processedAt: input.processedAt,
    status: input.status,
    payloadHash: input.payloadHash,
    error: input.error
  };
}

export function webhookEventToUpdate(
  patch: Partial<Omit<BillingWebhookEvent, "id" | "createdAt">>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (patch.provider !== undefined) data.provider = patch.provider;
  if (patch.providerEventId !== undefined) data.providerEventId = patch.providerEventId;
  if (patch.eventType !== undefined) data.eventType = patch.eventType;
  if (patch.processedAt !== undefined) data.processedAt = patch.processedAt;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.payloadHash !== undefined) data.payloadHash = patch.payloadHash;
  if (patch.error !== undefined) data.error = patch.error;
  return data;
}
