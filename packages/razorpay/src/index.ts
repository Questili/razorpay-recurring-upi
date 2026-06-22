/**
 * @questili/razorpay-recurring-upi-provider
 *
 * Razorpay Recurring Payments adapter for the Razorpay Recurring UPI Kit.
 */
import { createRazorpayProvider } from "./adapter.js";

export { createRazorpayProvider } from "./adapter.js";
export { createRazorpayProviderWithClient } from "./adapter.js";
export { computeCheckoutSignature, verifyCheckoutSignature, verifyWebhookSignature, computeWebhookSignature } from "./crypto.js";
export { createFetchTransport, RazorpayHttpError } from "./transport.js";
export type { HttpTransport, TransportResponse } from "./transport.js";
export { RazorpayClient } from "./client.js";
export { assertRecurringMethodAvailableInMode, isRazorpayTestModeKey } from "./config.js";
export { tokenStatusToMandate, paymentStatusToState, webhookPayloadToEvents, safeLabelForPayment } from "./map.js";
export type { RazorpayProviderOptions } from "./config.js";
export type * from "./types.js";

/**
 * Default export name matching the API sketch:
 *   providers: { razorpay: razorpayProvider({ keyId, keySecret, webhookSecret }) }
 */
export const razorpayProvider = createRazorpayProvider;
