/**
 * Signature tests for the Razorpay adapter crypto helpers. Razorpay uses
 * HMAC-SHA256; checkout signatures cover `${order_id}|${payment_id}` while
 * webhook signatures cover the raw request body.
 *
 * These exercise the real node:crypto-backed implementation exported from
 * @questili/razorpay-recurring-upi-provider. No network, fully deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  computeCheckoutSignature,
  verifyCheckoutSignature,
  computeWebhookSignature,
  verifyWebhookSignature
} from "@questili/razorpay-recurring-upi-provider";

const KEY_SECRET = "rzp_test_super_secret_key";

describe("checkout signature", () => {
  const orderId = "order_NJQyZcKzlrJqrE";
  const paymentId = "pay_NJQ1abc23XYZ";

  it("verifies a signature computed by computeCheckoutSignature", () => {
    const sig = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCheckoutSignature(orderId, paymentId, sig, KEY_SECRET)).toBe(true);
  });

  it("rejects a tampered order id", () => {
    const sig = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);
    expect(verifyCheckoutSignature("order_TAMPERED", paymentId, sig, KEY_SECRET)).toBe(false);
  });

  it("rejects a tampered payment id", () => {
    const sig = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);
    expect(verifyCheckoutSignature(orderId, "pay_TAMPERED", sig, KEY_SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);
    expect(verifyCheckoutSignature(orderId, paymentId, sig, "rzp_test_some_other_secret")).toBe(false);
  });

  it("rejects a malformed (non-hex) signature without throwing", () => {
    expect(verifyCheckoutSignature(orderId, paymentId, "not-a-hex-signature", KEY_SECRET)).toBe(false);
  });

  it("is order-dependent: swapping order/payment produces a different signature", () => {
    const a = computeCheckoutSignature(orderId, paymentId, KEY_SECRET);
    const b = computeCheckoutSignature(paymentId, orderId, KEY_SECRET);
    expect(a).not.toBe(b);
  });
});

describe("webhook signature", () => {
  const rawBody = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_NJQ1abc23XYZ", amount: 50000 } } }
  });

  it("verifies a signature computed by computeWebhookSignature over the raw body", () => {
    const sig = computeWebhookSignature(rawBody, KEY_SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(rawBody, sig, KEY_SECRET)).toBe(true);
  });

  it("rejects a modified body", () => {
    const sig = computeWebhookSignature(rawBody, KEY_SECRET);
    const tampered = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_EVIL", amount: 50000 } } }
    });
    expect(verifyWebhookSignature(tampered, sig, KEY_SECRET)).toBe(false);
  });

  it("rejects the wrong webhook secret", () => {
    const sig = computeWebhookSignature(rawBody, KEY_SECRET);
    expect(verifyWebhookSignature(rawBody, sig, "different_webhook_secret")).toBe(false);
  });

  it("rejects a signature computed over a different body than the one verified", () => {
    const other = JSON.stringify({ event: "payment.failed" });
    const sigFromOther = computeWebhookSignature(other, KEY_SECRET);
    expect(verifyWebhookSignature(rawBody, sigFromOther, KEY_SECRET)).toBe(false);
  });
});
