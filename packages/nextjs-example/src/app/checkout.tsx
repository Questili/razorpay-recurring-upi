"use client";

/**
 * Client-side checkout driver. Walks the full mandate -> subscribe lifecycle:
 *
 *   1. POST /api/billing/setup-mandate  -> Razorpay order + checkout data
 *   2. load Razorpay checkout.js and open the checkout modal
 *   3. on payment success, POST /api/billing/verify-mandate -> mandateId
 *   4. POST /api/billing/subscribe       -> subscription + first charge
 *
 * Minimal styling, inline. No external UI deps.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { BillingMethod, BillingPlanInput } from "@questili/razorpay-recurring-upi";

interface CheckoutProps {
  methods: Array<{ value: BillingMethod; label: string }>;
  plans: BillingPlanInput[];
}

interface SetupResponse {
  authorizationId: string;
  checkout: {
    keyId: string;
    orderId: string;
    customerId: string;
    recurring: "1" | "preferred";
    method: string;
  };
}

interface RazorpayHandlers {
  "razorpay_payment_id": string;
  "razorpay_order_id": string;
  "razorpay_signature": string;
}

// Minimal shape of the Razorpay checkout.js global (loaded via script tag).
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (resp: { error: { description?: string } }) => void): void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("browser only"));
    if (window.Razorpay) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout.js"));
    document.head.appendChild(script);
  });
}

function checkoutMethodOptions(method: BillingMethod): Record<string, true> {
  if (method === "card") return { card: true };
  if (method === "emandate") return { netbanking: true };
  return { upi: true };
}

function checkoutPrefill(input: { email: string; contact: string; name: string }): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
  );
}

export function Checkout({ methods, plans }: CheckoutProps): JSX.Element {
  const [customerId, setCustomerId] = useState("app_user_demo");
  const [email, setEmail] = useState("user@example.com");
  const [name, setName] = useState("Demo User");
  const [contact, setContact] = useState("");
  const [method, setMethod] = useState<BillingMethod>(methods[0]?.value ?? "upi");
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? "");
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  async function postJSON<T>(url: string, payload: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `${url} failed (${res.status})`);
    return data as T;
  }

  async function handleSubscribe(): Promise<void> {
    setError(null);
    setStatus("setting up mandate...");
    try {
      if (!methods.some((option) => option.value === method)) {
        throw new Error("Selected payment method is not available for this Razorpay mode.");
      }
      // 1. Setup mandate -> get Razorpay order + checkout data.
      const setup = await postJSON<SetupResponse>("/api/billing/setup-mandate", {
        customerId,
        email,
        name,
        contact,
        method
      });

      // 2. Load + open Razorpay checkout.
      setStatus("opening Razorpay checkout...");
      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error("Razorpay SDK not available");

      const handlers = await new Promise<RazorpayHandlers>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: setup.checkout.keyId,
          order_id: setup.checkout.orderId,
          name: "Razorpay Recurring UPI Demo",
          description: "Mandate authorization",
          recurring: setup.checkout.recurring,
          method: checkoutMethodOptions(method),
          prefill: checkoutPrefill({ email, contact, name }),
          handler: (response: RazorpayHandlers) => resolve(response),
          modal: { ondismiss: () => reject(new Error("Checkout dismissed by user")) }
        });
        rzp.on("payment.failed", (resp) => {
          reject(new Error(resp?.error?.description ?? "Razorpay payment failed"));
        });
        rzp.open();
      });

      // 3. Verify the checkout callback server-side -> confirmed mandate.
      setStatus("verifying mandate...");
      const verified = await postJSON<{ mandateId: string; status: string }>("/api/billing/verify-mandate", {
        authorizationId: setup.authorizationId,
        razorpay_payment_id: handlers.razorpay_payment_id,
        razorpay_order_id: handlers.razorpay_order_id,
        razorpay_signature: handlers.razorpay_signature
      });

      // 4. Create subscription + charge the first invoice.
      setStatus("creating subscription + charging first invoice...");
      const sub = await postJSON<{ subscriptionId: string; invoiceId: string | null; charge: unknown }>(
        "/api/billing/subscribe",
        {
          customerId,
          mandateId: verified.mandateId,
          planId
        }
      );

      setStatus(`done — subscription ${sub.subscriptionId} (mandate ${verified.status})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "checkout failed";
      setError(message);
      setStatus("failed");
    }
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box"
  };

  return (
    <section style={{ marginTop: 32, border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, background: "#fff" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Checkout</h2>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Customer ID</span>
          <input style={inputStyle} value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Email</span>
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Name</span>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Contact (optional)</span>
          <input style={inputStyle} value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Plan</span>
          <select style={inputStyle} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Method</span>
          <select style={inputStyle} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={handleSubscribe}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 16px",
          background: "#4f46e5",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        Authorize &amp; Subscribe
      </button>

      {status !== "idle" && (
        <p style={{ marginTop: 12, fontSize: 13, color: "#334155" }}>
          <strong>Status:</strong> {status}
        </p>
      )}
      {error && (
        <p style={{ marginTop: 8, fontSize: 13, color: "#b91c1c" }}>
          <strong>Error:</strong> {error}
        </p>
      )}
      <p style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
        After subscribing, view your subscription at{" "}
        <a href={`/portal?customerId=${encodeURIComponent(customerId)}`}>/portal?customerId={customerId}</a>.
      </p>
    </section>
  );
}
