/**
 * Pricing / checkout demo page (server component). Lists the configured plans
 * and renders the client checkout component which drives the full lifecycle:
 * setup-mandate -> Razorpay checkout -> verify-mandate -> subscribe.
 */
import { getCheckoutMethodOptions, plans } from "@/lib/billing";
import { Checkout } from "./checkout";

export const dynamic = "force-dynamic";

function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(paise / 100);
}

export default function Page(): JSX.Element {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Subscribe with UPI Autopay</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          End-to-end recurring billing on Razorpay: mandate authorization, checkout
          verification, subscription + first charge, and webhook reconciliation.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"
        }}
      >
        {plans.map((plan) => (
          <article
            key={plan.id}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: 20,
              background: "#fff"
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>{plan.name}</h2>
            <p style={{ margin: "0 0 16px", fontSize: 24, fontWeight: 600 }}>
              {formatPaise(plan.amount)}
              <span style={{ fontSize: 13, fontWeight: 400, color: "#64748b" }}>
                {" "}
                / {plan.interval === "monthly" ? "month" : "year"}
              </span>
            </p>
            <ul style={{ margin: "0 0 16px", paddingLeft: 18, color: "#334155", fontSize: 14 }}>
              {plan.features?.map((f) => (
                <li key={f} style={{ marginBottom: 4 }}>
                  {f}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <Checkout methods={getCheckoutMethodOptions()} plans={plans} />
    </main>
  );
}
