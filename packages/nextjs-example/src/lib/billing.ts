/**
 * Builds the kit facade for the example app.
 *
 * Storage: PostgreSQL via the Prisma adapter.
 * Provider: Razorpay (test mode keys from env).
 * Plans: two example INR plans (monthly + annual) defined in code-config.
 *
 * The kit owns the billing tables (mandates, subscriptions, invoices, ...).
 * This module is the single wiring point; API routes call `getBilling()` from
 * inside request handlers so `next build` can import route modules without real
 * Razorpay secrets.
 */
import { createRazorpayRecurringUpiBilling } from "@questili/razorpay-recurring-upi";
import { createPrismaStorage } from "@questili/razorpay-recurring-upi-prisma";
import { isRazorpayTestModeKey, razorpayProvider } from "@questili/razorpay-recurring-upi-provider";
import type { Billing, BillingConfig, BillingMethod } from "@questili/razorpay-recurring-upi";
import { prisma } from "./prisma";

/**
 * Example plan catalog. Money is in paise (INR subunits).
 *   - pro_monthly_inr: ₹499.00 / month
 *   - pro_annual_inr: ₹4,990.00 / year (~2 months free)
 *
 * Host apps typically load this from a DB or CMS; it is code-config here for the
 * sake of a self-contained example.
 */
const PLANS: BillingConfig["plans"] = [
  {
    id: "pro_monthly_inr",
    name: "Pro — Monthly",
    interval: "monthly",
    amount: 49900, // ₹499.00
    currency: "INR",
    features: ["Unlimited invoices", "Email support", "1 seat"]
  },
  {
    id: "pro_annual_inr",
    name: "Pro — Annual",
    interval: "annual",
    amount: 499000, // ₹4,990.00
    currency: "INR",
    features: ["Unlimited invoices", "Priority support", "1 seat", "Save ~17%"]
  }
];

export const plans = PLANS;

export interface CheckoutMethodOption {
  value: BillingMethod;
  label: string;
}

export function isRazorpayTestMode(): boolean {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  return keyId === "" || isRazorpayTestModeKey(keyId);
}

export function getCheckoutMethodOptions(): CheckoutMethodOption[] {
  const methods: CheckoutMethodOption[] = [
    { value: "upi", label: "UPI Autopay" },
    { value: "emandate", label: "Bank eMandate" }
  ];
  if (!isRazorpayTestMode()) {
    methods.splice(1, 0, { value: "card", label: "Card AutoPay" });
  }
  return methods;
}

export function isCheckoutMethodEnabled(method: BillingMethod): boolean {
  return getCheckoutMethodOptions().some((option) => option.value === method);
}

let billingInstance: Billing | null = null;

export function getBilling(): Billing {
  if (!billingInstance) {
    const config = getBillingConfig();
    billingInstance = createRazorpayRecurringUpiBilling({
      config,
      storage: createPrismaStorage(prisma),
      providers: {
        razorpay: razorpayProvider(getRazorpayOptions())
      }
    });
  }

  return billingInstance;
}

function getBillingConfig(): BillingConfig {
  return {
    plans: PLANS,
    gracePeriodDays: 7,
    // ₹50,000.00 single-charge cap covers annual renewals + retries with headroom.
    defaultMandateMaxAmount: 5000000,
    supportedMethods: ["upi", "card", "emandate"],
    // Razorpay-friendly retry cadence (exponential-ish, in ms).
    retryScheduleMs: [60_000, 3_600_000, 86_400_000],
    // Razorpay recurring authorization minimum (₹1.00).
    defaultAuthorizationAmount: 100,
    // Signs client-round-tripped upgrade/downgrade preview tokens.
    previewTokenSecret: requireEnv("BILLING_PREVIEW_TOKEN_SECRET")
  };
}

function getRazorpayOptions() {
  return {
    keyId: requireEnv("RAZORPAY_KEY_ID"),
    keySecret: requireEnv("RAZORPAY_KEY_SECRET"),
    webhookSecret: requireEnv("RAZORPAY_WEBHOOK_SECRET")
  };
}

function requireEnv(
  name: "RAZORPAY_KEY_ID" | "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET" | "BILLING_PREVIEW_TOKEN_SECRET"
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to run the billing example. Copy .env.example and set Razorpay test credentials.`);
  }
  return value;
}
