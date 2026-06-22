/**
 * Signature verification. Razorpay uses HMAC-SHA256.
 *
 *  - Checkout callback: HMAC-SHA256(`${order_id}|${payment_id}`, key_secret)
 *    compared (hex) to razorpay_signature.
 *  - Webhook: HMAC-SHA256(raw_body, webhook_secret) compared (hex) to the
 *    X-Razorpay-Signature header.
 *
 * Comparisons are constant-time to resist timing attacks.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function hexHmac(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function computeCheckoutSignature(orderId: string, paymentId: string, keySecret: string): string {
  return hexHmac(`${orderId}|${paymentId}`, keySecret);
}

export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  const expected = computeCheckoutSignature(orderId, paymentId, keySecret);
  return safeEqualHex(expected, signature.trim());
}

export function computeWebhookSignature(rawBody: string, webhookSecret: string): string {
  return hexHmac(rawBody, webhookSecret);
}

export function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  return safeEqualHex(computeWebhookSignature(rawBody, webhookSecret), signature.trim());
}
