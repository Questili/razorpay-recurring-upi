/**
 * Test helpers. Re-exports deterministic clock/id factories, the in-memory
 * storage, a default test config, a controllable {@link FakeProvider} that
 * implements the provider contract in-memory, and a `createTestBilling` that
 * wires them together so the full lifecycle can be exercised without network.
 */
import { createRazorpayRecurringUpiBilling } from "./api/create-billing.js";
import { FixedClock } from "./clock.js";
import { sequentialIdFactory } from "./ids.js";
import { InMemoryBillingStorage } from "./storage/in-memory.js";
import type { BillingStorage } from "./storage/types.js";
import type {
  CancelTokenInput,
  CancelTokenResult,
  ChargeOrderInput,
  ChargeOrderResult,
  CreateAuthorizationInput,
  CreateAuthorizationResult,
  CreateRecurringPaymentInput,
  CreateRecurringPaymentResult,
  PaymentStatusResult,
  ProviderCustomerInput,
  ProviderCustomerResult,
  RecurringPaymentProvider,
  TokenStatusResult,
  VerifyAuthorizationInput,
  VerifyAuthorizationResult,
  WebhookNormalizeInput,
  WebhookNormalizeResult
} from "./providers/types.js";
import type { BillingConfig, CreateBillingOptions, ProviderRegistry } from "./types/config.js";
import type { MandateStatus } from "./types/enums.js";
import type { RecurringPaymentState } from "./providers/types.js";

export { FixedClock } from "./clock.js";
export { sequentialIdFactory } from "./ids.js";
export { InMemoryBillingStorage } from "./storage/in-memory.js";

export const defaultTestConfig: BillingConfig = {
  plans: [
    { id: "starter_monthly_inr", name: "Starter", interval: "monthly", amount: 50000, currency: "INR", features: ["core"] },
    { id: "pro_monthly_inr", name: "Pro", interval: "monthly", amount: 150000, currency: "INR", features: ["core", "pro"] },
    { id: "pro_annual_inr", name: "Pro Annual", interval: "annual", amount: 1500000, currency: "INR", features: ["core", "pro"] },
    { id: "team_monthly_inr", name: "Team", interval: "monthly", amount: 500000, currency: "INR", features: ["team"] }
  ],
  gracePeriodDays: 7,
  defaultMandateMaxAmount: 1_000_000,
  supportedMethods: ["upi", "card", "emandate"],
  retryScheduleMs: [60_000, 300_000, 3_600_000],
  defaultAuthorizationAmount: 100,
  previewTokenSecret: "test-preview-token-secret-32-bytes-minimum"
};

export interface FakeProviderBehavior {
  /** Outcome of the next createRecurringPayment call. */
  nextPaymentState?: RecurringPaymentState;
  nextFailureCode?: string;
  nextFailureDescription?: string;
  /** Whether fetchPaymentStatus flips a pending payment to captured (UPI async). */
  asyncCapture?: boolean;
  /** Mandate status reported at verification. */
  verifyStatus?: MandateStatus;
  /** Safe instrument label reported at verification. */
  instrumentLabel?: string;
}

/**
 * A fully in-memory provider that implements the RecurringPaymentProvider
 * contract. Tests can mutate `behavior` between calls to drive different
 * outcomes (captured / pending / failed / reauthorization).
 */
export class FakeProvider implements RecurringPaymentProvider {
  readonly name = "razorpay" as const;
  behavior: FakeProviderBehavior;
  private customerSeq = 0;
  private tokenSeq = 0;
  private orderSeq = 0;
  private paymentSeq = 0;
  private tokens = new Map<string, { status: MandateStatus; maxAmount: number }>();
  private payments = new Map<string, { state: RecurringPaymentState; amount: number }>();
  /** Payments reported as pending that should capture on the next status poll. */
  readonly pendingToCapture = new Set<string>();
  /** Inputs received by createOrReuseCustomer; useful for contract tests. */
  readonly customerInputs: ProviderCustomerInput[] = [];
  readonly webhookSecret = "test_webhook_secret";

  constructor(behavior: FakeProviderBehavior = {}) {
    this.behavior = { nextPaymentState: "captured", verifyStatus: "confirmed", ...behavior };
  }

  async createOrReuseCustomer(input: ProviderCustomerInput): Promise<ProviderCustomerResult> {
    this.customerInputs.push(input);
    if (input.providerCustomerId) {
      return { providerCustomerId: input.providerCustomerId, created: false };
    }
    this.customerSeq += 1;
    return { providerCustomerId: `cust_fake_${this.customerSeq}`, created: true };
  }

  async createAuthorization(input: CreateAuthorizationInput): Promise<CreateAuthorizationResult> {
    this.orderSeq += 1;
    return {
      providerOrderId: `order_fake_${this.orderSeq}`,
      checkout: {
        keyId: "rzp_test_fakekey",
        orderId: `order_fake_${this.orderSeq}`,
        customerId: input.providerCustomerId,
        recurring: "1",
        method: input.method
      }
    };
  }

  async verifyAuthorization(_input: VerifyAuthorizationInput): Promise<VerifyAuthorizationResult> {
    this.paymentSeq += 1;
    this.tokenSeq += 1;
    const providerTokenId = `token_fake_${this.tokenSeq}`;
    const providerPaymentId = `pay_fake_${this.paymentSeq}`;
    const status = this.behavior.verifyStatus ?? "confirmed";
    this.tokens.set(providerTokenId, { status, maxAmount: 1_000_000 });
    return {
      providerPaymentId,
      providerTokenId,
      status,
      maxAmount: 1_000_000,
      frequency: "as_presented",
      expiresAt: new Date("2036-01-01T00:00:00Z"),
      safeInstrumentLabel: this.behavior.instrumentLabel ?? "Test Bank ••1234",
      providerMetadata: {}
    };
  }

  async createChargeOrder(input: ChargeOrderInput): Promise<ChargeOrderResult> {
    this.orderSeq += 1;
    void input;
    return { providerOrderId: `order_fake_${this.orderSeq}` };
  }

  async createRecurringPayment(input: CreateRecurringPaymentInput): Promise<CreateRecurringPaymentResult> {
    this.paymentSeq += 1;
    const providerPaymentId = `pay_fake_${this.paymentSeq}`;
    const state = this.behavior.nextPaymentState ?? "captured";
    this.payments.set(providerPaymentId, { state, amount: input.amount });
    if (state === "pending" && this.behavior.asyncCapture) {
      this.pendingToCapture.add(providerPaymentId);
    }
    if (state === "failed") {
      return {
        providerPaymentId,
        state: "failed",
        failure: {
          providerErrorCode: this.behavior.nextFailureCode ?? "INSUFFICIENT_FUNDS",
          providerErrorDescription: this.behavior.nextFailureDescription ?? "insufficient funds"
        }
      };
    }
    return { providerPaymentId, state, failure: null };
  }

  async cancelToken(input: CancelTokenInput): Promise<CancelTokenResult> {
    const t = this.tokens.get(input.providerTokenId);
    if (t) t.status = "cancelled";
    return { cancelled: true, status: "cancelled" };
  }

  async fetchTokenStatus(providerTokenId: string): Promise<TokenStatusResult> {
    const t = this.tokens.get(providerTokenId);
    return { providerTokenId, status: t?.status ?? "unknown", maxAmount: t?.maxAmount ?? 0, expiresAt: null };
  }

  async fetchPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const p = this.payments.get(providerPaymentId);
    let state = p?.state ?? "failed";
    if (this.pendingToCapture.has(providerPaymentId)) {
      this.pendingToCapture.delete(providerPaymentId);
      state = "captured";
      this.payments.set(providerPaymentId, { state, amount: p?.amount ?? 0 });
    }
    return { providerPaymentId, state, amount: p?.amount ?? 0, failure: state === "failed" ? { providerErrorCode: "FAILED" } : null };
  }

  async verifyWebhookSignature(): Promise<boolean> {
    return true;
  }

  async normalizeWebhook(input: WebhookNormalizeInput): Promise<WebhookNormalizeResult> {
    // Fake provider: any signed payload with a JSON body is "verified".
    const verified = input.signature !== null;
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      parsed = {};
    }
    return { verified, providerEventId: input.providerEventId, events: [], rawPayload: parsed };
  }
}

export interface TestBillingOverrides {
  config?: Partial<BillingConfig>;
  storage?: BillingStorage;
  clock?: FixedClock;
  provider?: RecurringPaymentProvider;
  providers?: ProviderRegistry;
}

export function createTestBilling(overrides: TestBillingOverrides = {}) {
  const clock = overrides.clock ?? new FixedClock(new Date("2026-01-01T00:00:00Z"));
  const storage = overrides.storage ?? new InMemoryBillingStorage({ clock, idFactory: sequentialIdFactory(1) });
  const config: BillingConfig = { ...defaultTestConfig, ...overrides.config };
  const provider = overrides.provider ?? new FakeProvider();
  const options: CreateBillingOptions = {
    config,
    storage,
    providers: overrides.providers ?? ({ razorpay: provider } as ProviderRegistry),
    clock,
    idFactory: sequentialIdFactory(1)
  };
  return { clock, storage, provider, billing: createRazorpayRecurringUpiBilling(options) };
}
