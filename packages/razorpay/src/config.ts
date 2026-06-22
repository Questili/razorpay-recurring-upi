/**
 * Razorpay adapter configuration. Credentials are read from the host app (env),
 * never hard-coded. The adapter supports test mode via the default base URL and
 * a separate live URL when the host opts in.
 */
import type { BillingMethod } from "@questili/razorpay-recurring-upi";

export const RAZORPAY_TEST_BASE_URL = "https://api.razorpay.com/v1";
export const RAZORPAY_LIVE_BASE_URL = "https://api.razorpay.com/v1";

export interface RazorpayProviderOptions {
  /** Key id (rzp_test_... or rzp_live_...). Also surfaced to checkout.keyId. */
  keyId: string;
  /** Key secret used for server-side API calls. */
  keySecret: string;
  /** Webhook secret used to verify X-Razorpay-Signature. */
  webhookSecret: string;
  /** Override the API base url (rare). Defaults to the standard endpoint. */
  baseUrl?: string;
  /** Map a kit BillingMethod to a Razorpay recurring auth payload, if needed. */
  methodEndpoint?: Partial<Record<BillingMethod, string>>;
  /** Display name shown in checkout (Razorpay `name` field). */
  merchantName?: string;
}

export function resolveBaseUrl(opts: RazorpayProviderOptions): string {
  return opts.baseUrl ?? RAZORPAY_TEST_BASE_URL;
}

export function validateOptions(opts: RazorpayProviderOptions): void {
  const missing: string[] = [];
  if (!opts.keyId) missing.push("keyId");
  if (!opts.keySecret) missing.push("keySecret");
  if (!opts.webhookSecret) missing.push("webhookSecret");
  if (missing.length > 0) {
    throw new Error(`[razorpay] Missing required option(s): ${missing.join(", ")}`);
  }
}

export function isRazorpayTestModeKey(keyId: string): boolean {
  return keyId.startsWith("rzp_test_");
}

export function assertRecurringMethodAvailableInMode(method: BillingMethod, keyId: string): void {
  if (method === "card" && isRazorpayTestModeKey(keyId)) {
    throw new Error(
      "[razorpay] Card AutoPay recurring authorization is not supported with Razorpay test mode keys. Use UPI/eMandate in test mode, or retry card AutoPay with live-mode recurring payments enabled."
    );
  }
}
