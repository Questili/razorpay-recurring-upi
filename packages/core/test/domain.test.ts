/**
 * Pure unit tests for the core domain layer. No I/O, no clock, no provider.
 * Covers proration, discounts, invoice building, entitlement, failure
 * classification, state machines, and money helpers.
 */
import { describe, it, expect } from "vitest";
import {
  computeProration,
  buildInvoice,
  chargeableAmount,
  validateDiscountCode,
  shouldApplyDiscount,
  discountAmount,
  computeEntitlement,
  classifyFailure,
  nextRetryAt,
  DEFAULT_FAILURE_CONFIG,
  subscriptionMachine,
  mandateMachine,
  invoiceMachine,
  chargeAttemptMachine,
  assertSubunits,
  roundPaise,
  allocate,
  formatForDisplay,
  periodFor,
  BillingError,
  type BillingDiscount,
  type BillingSubscription,
  type BillingConfig,
  type FailureClass
} from "@questili/razorpay-recurring-upi";

// ---------- helpers ----------

const MS_DAY = 24 * 60 * 60 * 1000;

function plan(overrides: Partial<{ id: string; name: string; interval: "monthly" | "annual"; amount: number; currency: "INR" }> = {}) {
  return {
    id: overrides.id ?? "starter_monthly_inr",
    name: overrides.name ?? "Starter",
    interval: overrides.interval ?? ("monthly" as const),
    amount: overrides.amount ?? 50000,
    currency: overrides.currency ?? ("INR" as const),
    features: []
  };
}

function discount(overrides: Partial<BillingDiscount> = {}): BillingDiscount {
  return {
    id: overrides.id ?? "disc_1",
    code: overrides.code ?? "SAVE10",
    type: overrides.type ?? "percent",
    value: overrides.value ?? 10,
    duration: overrides.duration ?? "once",
    durationInCycles: overrides.durationInCycles ?? null,
    validFrom: overrides.validFrom ?? null,
    validUntil: overrides.validUntil ?? null,
    maxRedemptions: overrides.maxRedemptions ?? null,
    active: overrides.active ?? true,
    appliesToPlanIds: overrides.appliesToPlanIds ?? null,
    metadata: {},
    createdAt: new Date(0),
    updatedAt: new Date(0)
  } as BillingDiscount;
}

const now = new Date("2026-01-15T00:00:00Z");
const baseConfig: BillingConfig = {
  plans: [],
  gracePeriodDays: 7,
  defaultMandateMaxAmount: 1_000_000,
  supportedMethods: ["upi", "card", "emandate"],
  retryScheduleMs: [60_000, 300_000, 3_600_000],
  defaultAuthorizationAmount: 100,
  previewTokenSecret: "test-preview-token-secret-32-bytes-minimum"
};

// ---------- proration ----------

describe("proration", () => {
  const periodStart = new Date("2026-01-01T00:00:00Z");
  const periodEnd = new Date("2026-02-01T00:00:00Z"); // 31-day month

  it("returns fraction=1 at the start of the period (full period remaining)", () => {
    const r = computeProration({
      periodStart,
      periodEnd,
      now: periodStart,
      oldAmount: 50000,
      newAmount: 150000
    });
    expect(r.fraction).toBe(1);
    expect(r.credit).toBe(50000);
    expect(r.debit).toBe(150000);
    expect(r.net).toBe(100000);
  });

  it("computes proportional credit + debit + net at mid-period", () => {
    // 31-day period, now = Jan 16 -> 16 days remaining -> 16/31 fraction.
    const nowMid = new Date("2026-01-16T00:00:00Z");
    const r = computeProration({ periodStart, periodEnd, now: nowMid, oldAmount: 50000, newAmount: 150000 });
    const fraction = 16 / 31;
    expect(r.fraction).toBeCloseTo(fraction, 10);
    expect(r.credit).toBe(roundPaise(50000 * fraction));
    expect(r.debit).toBe(roundPaise(150000 * fraction));
    expect(r.net).toBe(r.debit - r.credit);
    // integer subunits always
    expect(Number.isInteger(r.credit)).toBe(true);
    expect(Number.isInteger(r.debit)).toBe(true);
    expect(Number.isInteger(r.net)).toBe(true);
  });

  it("returns zero credit/debit when the period has no remaining time", () => {
    const r = computeProration({
      periodStart,
      periodEnd,
      now: new Date("2026-03-01T00:00:00Z"),
      oldAmount: 50000,
      newAmount: 150000
    });
    expect(r.fraction).toBe(0);
    expect(r.credit).toBe(0);
    expect(r.debit).toBe(0);
    expect(r.net).toBe(0);
  });

  it("rounds to integer subunits (paise) with no float drift", () => {
    // 100 paise old, 1/3 of the period remaining -> 33.33 -> rounds to 33.
    const r = computeProration({
      periodStart,
      periodEnd,
      now: new Date("2026-01-21T12:00:00Z"), // ~11/31 remaining, small amounts
      oldAmount: 101,
      newAmount: 103
    });
    expect(Number.isInteger(r.credit)).toBe(true);
    expect(Number.isInteger(r.debit)).toBe(true);
    expect(r.credit).toBeGreaterThanOrEqual(0);
    expect(r.debit).toBeGreaterThanOrEqual(0);
  });

  it("rejects non-integer or negative amounts", () => {
    expect(() =>
      computeProration({ periodStart, periodEnd, now, oldAmount: 1.5, newAmount: 100 })
    ).toThrow(BillingError);
    expect(() =>
      computeProration({ periodStart, periodEnd, now, oldAmount: -1, newAmount: 100 })
    ).toThrow(BillingError);
  });
});

// ---------- discount ----------

describe("discount.amount", () => {
  it("percent: applies the percentage, capped at the subtotal", () => {
    expect(discountAmount(discount({ type: "percent", value: 10 }), 50000)).toBe(5000);
    // 200% would exceed subtotal -> capped.
    expect(discountAmount(discount({ type: "percent", value: 200 }), 50000)).toBe(50000);
    expect(discountAmount(discount({ type: "percent", value: 0 }), 50000)).toBe(0);
  });

  it("fixed_amount: applies the flat amount, capped at the subtotal", () => {
    expect(discountAmount(discount({ type: "fixed_amount", value: 5000 }), 50000)).toBe(5000);
    expect(discountAmount(discount({ type: "fixed_amount", value: 999999 }), 50000)).toBe(50000);
  });

  it("free_trial: covers the entire subtotal", () => {
    expect(discountAmount(discount({ type: "free_trial" }), 50000)).toBe(50000);
    expect(discountAmount(discount({ type: "free_trial" }), 0)).toBe(0);
  });
});

describe("discount.shouldApply", () => {
  it("once: applies only on the first cycle", () => {
    const d = discount({ duration: "once" });
    expect(shouldApplyDiscount(d, 0)).toBe(true);
    expect(shouldApplyDiscount(d, 1)).toBe(false);
    expect(shouldApplyDiscount(d, 5)).toBe(false);
  });

  it("repeating: applies while priorAppliedCycles < durationInCycles", () => {
    const d = discount({ duration: "repeating", durationInCycles: 3 });
    expect(shouldApplyDiscount(d, 0)).toBe(true);
    expect(shouldApplyDiscount(d, 2)).toBe(true);
    expect(shouldApplyDiscount(d, 3)).toBe(false);
  });

  it("forever: always applies", () => {
    const d = discount({ duration: "forever" });
    expect(shouldApplyDiscount(d, 0)).toBe(true);
    expect(shouldApplyDiscount(d, 999)).toBe(true);
  });
});

describe("discount.validateDiscountCode", () => {
  const baseInput = { code: "SAVE10", customerId: "cust_1", planId: "starter_monthly_inr", now };

  it("passes a healthy active code", () => {
    expect(validateDiscountCode(discount(), baseInput, 0)).toEqual({ valid: true });
  });

  it("rejects an inactive discount", () => {
    expect(validateDiscountCode(discount({ active: false }), baseInput, 0)).toEqual({
      valid: false,
      reason: "inactive"
    });
  });

  it("rejects an expired discount (now after validUntil)", () => {
    const d = discount({ validUntil: new Date("2025-12-31T00:00:00Z") });
    expect(validateDiscountCode(d, baseInput, 0)).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects when max_redemptions has been reached", () => {
    const d = discount({ maxRedemptions: 5 });
    expect(validateDiscountCode(d, baseInput, 5)).toEqual({
      valid: false,
      reason: "max_redemptions_reached"
    });
    // exactly at the cap is blocked; below it is fine.
    expect(validateDiscountCode(d, baseInput, 4)).toEqual({ valid: true });
  });

  it("rejects a plan that is not eligible", () => {
    const d = discount({ appliesToPlanIds: ["pro_monthly_inr"] });
    expect(validateDiscountCode(d, baseInput, 0)).toEqual({ valid: false, reason: "plan_not_eligible" });
    // an eligible plan passes.
    expect(
      validateDiscountCode(d, { ...baseInput, planId: "pro_monthly_inr" }, 0)
    ).toEqual({ valid: true });
  });

  it("rejects an invalid percent value (>100)", () => {
    const d = discount({ type: "percent", value: 150 });
    expect(validateDiscountCode(d, baseInput, 0)).toEqual({ valid: false, reason: "invalid_percent_value" });
  });

  it("rejects a code that does not match (case-insensitive)", () => {
    expect(validateDiscountCode(discount({ code: "SAVE10" }), { ...baseInput, code: "OTHER" }, 0))
      .toEqual({ valid: false, reason: "code_mismatch" });
    // case-insensitive match is accepted.
    expect(validateDiscountCode(discount({ code: "SAVE10" }), { ...baseInput, code: "save10" }, 0))
      .toEqual({ valid: true });
  });
});

// ---------- invoice builder ----------

describe("invoice builder", () => {
  const period = periodFor(new Date("2026-01-01T00:00:00Z"), "monthly");

  it("builds a single plan line for a renewal/initial invoice", () => {
    const inv = buildInvoice({ plan: plan({ amount: 50000 }), reason: "renewal", period, now });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]!.type).toBe("plan");
    expect(inv.lines[0]!.amount).toBe(50000);
    expect(inv.subtotal).toBe(50000);
    expect(inv.discountTotal).toBe(0);
    expect(inv.taxTotal).toBe(0);
    expect(inv.total).toBe(50000);
  });

  it("builds a proration credit + debit for an immediate upgrade", () => {
    // Mid-period upgrade: starter -> pro on Jan 15.
    const inv = buildInvoice({
      plan: plan({ id: "pro_monthly_inr", name: "Pro", amount: 150000 }),
      reason: "upgrade",
      period,
      now: new Date("2026-01-15T00:00:00Z"),
      upgradeFromAmount: 50000
    });
    const prorationLines = inv.lines.filter((l) => l.type === "proration");
    expect(prorationLines.length).toBe(2);
    const credit = prorationLines.find((l) => l.amount < 0)!;
    const debit = prorationLines.find((l) => l.amount > 0)!;
    expect(credit.amount).toBeLessThan(0);
    expect(debit.amount).toBeGreaterThan(0);
    expect(inv.subtotal).toBe(credit.amount + debit.amount);
    expect(inv.total).toBe(inv.subtotal); // no discounts/tax
  });

  it("appends a negative discount line and reconciles totals", () => {
    const inv = buildInvoice({
      plan: plan({ amount: 50000 }),
      reason: "initial",
      period,
      now,
      discounts: [{ discount: discount({ type: "percent", value: 10, duration: "once" }), priorAppliedCycles: 0 }]
    });
    const discLine = inv.lines.find((l) => l.type === "discount")!;
    expect(discLine.amount).toBe(-5000);
    expect(inv.subtotal).toBe(50000); // subtotal is pre-discount
    expect(inv.discountTotal).toBe(5000);
    expect(inv.total).toBe(45000); // 50000 - 5000
    // subtotal - discountTotal + taxTotal == total invariant
    expect(inv.subtotal - inv.discountTotal + inv.taxTotal).toBe(inv.total);
  });

  it("chargeableAmount floors a negative net at zero", () => {
    expect(chargeableAmount(-500)).toBe(0);
    expect(chargeableAmount(0)).toBe(0);
    expect(chargeableAmount(12345)).toBe(12345);
  });
});

// ---------- entitlement ----------

describe("entitlement", () => {
  function sub(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
    const accessEndsAt = overrides.accessEndsAt ?? new Date("2026-02-01T00:00:00Z");
    return {
      id: "sub_1",
      billingCustomerId: "cust_1",
      mandateId: "mandate_1",
      planId: "starter_monthly_inr",
      status: overrides.status ?? "active",
      currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
      currentPeriodEnd: accessEndsAt,
      nextBillingAt: accessEndsAt,
      accessEndsAt,
      cancelAtPeriodEnd: false,
      cancellationRequestedAt: null,
      canceledAt: null,
      cancelReason: null,
      pendingPlanId: null,
      pendingPlanEffectiveAt: null,
      trialEndsAt: overrides.trialEndsAt ?? null,
      metadata: {},
      createdAt: new Date(0),
      updatedAt: new Date(0)
    } as BillingSubscription;
  }

  it("grants access for active within the period", () => {
    const d = computeEntitlement(sub({ status: "active" }), baseConfig, new Date("2026-01-15T00:00:00Z"));
    expect(d.hasAccess).toBe(true);
    expect(d.reason).toBe("active");
  });

  it("grants access for cancel_at_period_end within the period", () => {
    const d = computeEntitlement(
      sub({ status: "cancel_at_period_end" }),
      baseConfig,
      new Date("2026-01-15T00:00:00Z")
    );
    expect(d.hasAccess).toBe(true);
    expect(d.reason).toBe("cancel_at_period_end");
  });

  it("denies access for active past accessEndsAt", () => {
    const d = computeEntitlement(sub({ status: "active" }), baseConfig, new Date("2026-03-01T00:00:00Z"));
    expect(d.hasAccess).toBe(false);
    expect(d.reason).toBe("expired");
  });

  it("grants grace access for past_due within grace window", () => {
    const d = computeEntitlement(sub({ status: "past_due" }), baseConfig, new Date("2026-02-05T00:00:00Z"));
    expect(d.hasAccess).toBe(true);
    expect(d.reason).toBe("grace");
  });

  it("denies access for past_due past grace (gracePeriodDays=7)", () => {
    const d = computeEntitlement(sub({ status: "past_due" }), baseConfig, new Date("2026-02-10T00:00:00Z"));
    expect(d.hasAccess).toBe(false);
    expect(d.reason).toBe("inactive");
  });

  it("grants grace access for payment_pending within grace", () => {
    const d = computeEntitlement(
      sub({ status: "payment_pending" }),
      baseConfig,
      new Date("2026-02-03T00:00:00Z")
    );
    expect(d.hasAccess).toBe(true);
    expect(d.reason).toBe("grace");
  });

  it("denies access for expired and draft", () => {
    expect(
      computeEntitlement(sub({ status: "expired" }), baseConfig, new Date("2026-01-15T00:00:00Z")).hasAccess
    ).toBe(false);
    expect(
      computeEntitlement(sub({ status: "draft" }), baseConfig, new Date("2026-01-15T00:00:00Z")).hasAccess
    ).toBe(false);
  });

  it("denies access for canceled after accessEndsAt", () => {
    const d = computeEntitlement(sub({ status: "canceled" }), baseConfig, new Date("2026-03-01T00:00:00Z"));
    expect(d.hasAccess).toBe(false);
  });

  it("trial overrides everything: access granted while now < trialEndsAt even if status is draft-like", () => {
    const d = computeEntitlement(
      sub({ status: "pending_authorization", trialEndsAt: new Date("2026-02-15T00:00:00Z") }),
      baseConfig,
      new Date("2026-01-15T00:00:00Z")
    );
    expect(d.hasAccess).toBe(true);
    expect(d.reason).toBe("trial");
  });

  it("no subscription -> no_subscription", () => {
    const d = computeEntitlement(null, baseConfig, now);
    expect(d.hasAccess).toBe(false);
    expect(d.reason).toBe("no_subscription");
  });
});

// ---------- failure classification ----------

describe("failure classification", () => {
  const cfg = DEFAULT_FAILURE_CONFIG;

  function classify(
    parts: Partial<{ code: string; desc: string; status: string; paymentStatus: string }>,
    config = cfg
  ): FailureClass {
    return classifyFailure(
      {
        providerErrorCode: parts.code ?? null,
        providerErrorDescription: parts.desc ?? null,
        providerStatus: parts.status ?? null,
        providerPaymentStatus: parts.paymentStatus ?? null
      },
      config
    ).class;
  }

  it("classifies insufficient funds / bank / timeout as retryable", () => {
    expect(classify({ code: "INSUFFICIENT_FUNDS" })).toBe("retryable");
    expect(classify({ desc: "bank declined the transaction" })).toBe("retryable");
    expect(classify({ desc: "request timeout" })).toBe("retryable");
  });

  it("classifies mandate/token/expired as reauthorization_required", () => {
    expect(classify({ desc: "mandate has been cancelled" })).toBe("reauthorization_required");
    expect(classify({ code: "TOKEN_EXPIRED" })).toBe("reauthorization_required");
    expect(classify({ desc: "instrument invalid" })).toBe("reauthorization_required");
  });

  it("classifies revoked as terminal (precedence over reauthorization)", () => {
    // 'revoked' is terminal and beats the reauthorization bucket.
    expect(classify({ code: "MANDATE_REVOKED", desc: "mandate revoked by user" })).toBe("terminal");
  });

  it("classifies ambiguous/reconciliation as support_required", () => {
    expect(classify({ desc: "ambiguous processor state" })).toBe("support_required");
    expect(classify({ desc: "reconciliation mismatch" })).toBe("support_required");
  });

  it("defaults to retryable when nothing matches", () => {
    expect(classify({ code: "SOMETHING_NEW_WE_DONT_KNOW" })).toBe("retryable");
    expect(classify({})).toBe("retryable"); // empty haystack -> default
  });

  it("terminal takes precedence over reauthorization and retryable", () => {
    // 'fraud' is terminal even though 'invalid' would also match reauthorization.
    expect(classify({ desc: "fraud invalid mandate" })).toBe("terminal");
  });
});

describe("nextRetryAt", () => {
  const schedule = [60_000, 300_000, 3_600_000];
  const base = new Date("2026-01-01T00:00:00Z");

  it("schedules the next attempt from the configured delay for the attempt number", () => {
    expect(nextRetryAt(1, schedule, base)).toEqual(new Date(base.getTime() + 60_000));
    expect(nextRetryAt(2, schedule, base)).toEqual(new Date(base.getTime() + 300_000));
    expect(nextRetryAt(3, schedule, base)).toEqual(new Date(base.getTime() + 3_600_000));
  });

  it("returns null once the schedule is exhausted", () => {
    expect(nextRetryAt(4, schedule, base)).toBeNull();
    expect(nextRetryAt(99, schedule, base)).toBeNull();
  });
});

// ---------- state machines ----------

describe("state machines", () => {
  describe("subscription", () => {
    it("allows legal transitions", () => {
      expect(subscriptionMachine.canTransition("draft", "active")).toBe(true);
      expect(subscriptionMachine.canTransition("active", "past_due")).toBe(true);
      expect(subscriptionMachine.canTransition("active", "cancel_at_period_end")).toBe(true);
      expect(subscriptionMachine.canTransition("past_due", "active")).toBe(true);
      expect(subscriptionMachine.canTransition("cancel_at_period_end", "active")).toBe(true);
    });

    it("rejects illegal transitions via assertTransition", () => {
      expect(() => subscriptionMachine.assertTransition("canceled", "active")).toThrow(BillingError);
      expect(() => subscriptionMachine.assertTransition("canceled", "active")).toThrow(/ILLEGAL_TRANSITION|Illegal/);
      // canceled is terminal: no successors.
      expect(subscriptionMachine.canTransition("canceled", "active")).toBe(false);
      expect(subscriptionMachine.canTransition("expired", "active")).toBe(false);
    });

    it("marks canceled and expired as terminal", () => {
      expect(subscriptionMachine.isTerminal("canceled")).toBe(true);
      expect(subscriptionMachine.isTerminal("expired")).toBe(true);
      expect(subscriptionMachine.isTerminal("active")).toBe(false);
    });
  });

  describe("mandate", () => {
    it("allows initiated -> confirmed/rejected/cancelled/expired", () => {
      expect(mandateMachine.canTransition("initiated", "confirmed")).toBe(true);
      expect(mandateMachine.canTransition("initiated", "rejected")).toBe(true);
      expect(mandateMachine.canTransition("confirmed", "paused")).toBe(true);
      expect(mandateMachine.canTransition("paused", "confirmed")).toBe(true);
    });
    it("rejects illegal transitions", () => {
      expect(() => mandateMachine.assertTransition("rejected", "confirmed")).toThrow(BillingError);
      expect(() => mandateMachine.assertTransition("cancelled", "confirmed")).toThrow(BillingError);
    });
    it("marks terminal mandate states", () => {
      for (const s of ["rejected", "cancelled", "expired"] as const) {
        expect(mandateMachine.isTerminal(s)).toBe(true);
      }
    });
  });

  describe("invoice", () => {
    it("allows draft -> open -> paid/void/uncollectible", () => {
      expect(invoiceMachine.canTransition("draft", "open")).toBe(true);
      expect(invoiceMachine.canTransition("open", "paid")).toBe(true);
      expect(invoiceMachine.canTransition("open", "void")).toBe(true);
      expect(invoiceMachine.canTransition("open", "uncollectible")).toBe(true);
      expect(invoiceMachine.canTransition("uncollectible", "open")).toBe(true);
    });
    it("rejects transitions out of paid", () => {
      expect(() => invoiceMachine.assertTransition("paid", "open")).toThrow(BillingError);
      expect(invoiceMachine.isTerminal("paid")).toBe(true);
      expect(invoiceMachine.isTerminal("void")).toBe(true);
    });
  });

  describe("chargeAttempt", () => {
    it("allows scheduled/submitted -> captured/pending/failed paths", () => {
      expect(chargeAttemptMachine.canTransition("scheduled", "submitted")).toBe(true);
      expect(chargeAttemptMachine.canTransition("submitted", "captured")).toBe(true);
      expect(chargeAttemptMachine.canTransition("submitted", "pending")).toBe(true);
      expect(chargeAttemptMachine.canTransition("submitted", "failed_retryable")).toBe(true);
      expect(chargeAttemptMachine.canTransition("failed_retryable", "scheduled")).toBe(true);
      expect(chargeAttemptMachine.canTransition("failed_retryable", "submitted")).toBe(true);
    });
    it("rejects transitions out of captured/terminal", () => {
      expect(() => chargeAttemptMachine.assertTransition("captured", "pending")).toThrow(BillingError);
      expect(() => chargeAttemptMachine.assertTransition("failed_terminal", "scheduled")).toThrow(BillingError);
      expect(chargeAttemptMachine.isTerminal("captured")).toBe(true);
      expect(chargeAttemptMachine.isTerminal("failed_terminal")).toBe(true);
    });
  });
});

// ---------- money ----------

describe("money", () => {
  it("assertSubunits rejects non-integer and negative amounts", () => {
    expect(() => assertSubunits(1.5)).toThrow(BillingError);
    expect(() => assertSubunits(-1)).toThrow(BillingError);
    expect(assertSubunits(0)).toBe(0);
    expect(assertSubunits(12345)).toBe(12345);
    expect(() => assertSubunits(1.5, "amount")).toThrow(/amount/);
  });

  it("roundPaise rounds half-up for positive and negative values", () => {
    expect(roundPaise(1.4)).toBe(1);
    expect(roundPaise(1.5)).toBe(2);
    expect(roundPaise(2.5)).toBe(3);
    expect(roundPaise(0.499)).toBe(0);
    expect(roundPaise(-1.5)).toBe(-2);
  });

  it("allocate divides subunits and rounds to the nearest paise", () => {
    expect(allocate(100, 1, 3)).toBe(33); // 33.33 -> 33
    expect(allocate(100, 2, 3)).toBe(67); // 66.66 -> 67
    expect(allocate(100, 1, 4)).toBe(25);
    expect(() => allocate(100, 1, 0)).toThrow(BillingError);
    expect(() => allocate(-1, 1, 2)).toThrow(BillingError);
  });

  it("formatForDisplay renders subunits as currency strings", () => {
    expect(formatForDisplay(5000)).toBe("₹50.00");
    expect(formatForDisplay(505)).toBe("₹5.05");
    expect(formatForDisplay(0)).toBe("₹0.00");
    expect(formatForDisplay(-5000)).toBe("-₹50.00");
    expect(formatForDisplay(5000, "USD")).toBe("USD 50.00");
  });
});

// referenced to keep the MS_DAY import meaningful for period math sanity
void MS_DAY;
