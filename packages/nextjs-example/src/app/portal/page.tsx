/**
 * Billing portal (server component). Given ?customerId=, shows the current
 * subscription, plan, renewal date, access status, mandate, and invoices, with
 * cancel controls. Reads directly from the kit facade — no separate DB layer.
 */
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getBilling } from "@/lib/billing";
import type { BillingInvoice, BillingSubscription, BillingMandate, EntitlementResult } from "@questili/razorpay-recurring-upi";
import { CancelButton } from "./cancel-button";

function formatPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(paise / 100);
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

export default async function PortalPage({
  searchParams
}: {
  searchParams: Promise<{ customerId?: string }>;
}): Promise<JSX.Element> {
  const { customerId } = await searchParams;

  if (!customerId) {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 22 }}>Billing Portal</h1>
        <p style={{ color: "#475569" }}>Missing customer id. Open /portal?customerId=app_user_demo</p>
        <p>
          <Link href="/" style={{ color: "#4f46e5" }}>
            ← Back to pricing
          </Link>
        </p>
      </main>
    );
  }

  // Access decision (entitlement).
  const billing = getBilling();
  const access: EntitlementResult = await billing.entitlement.getAccessForCustomer(customerId);

  // Resolve the internal customer to fetch the active subscription + mandate.
  const customer = await billing.customers.getByExternalId(customerId);
  let subscription: BillingSubscription | undefined;
  let mandate: BillingMandate | undefined;
  let invoices: BillingInvoice[] = [];

  if (customer) {
    subscription = await billing.subscriptions.getActiveForCustomer(customer.id);
    if (subscription?.mandateId) {
      mandate = await billing.mandates.get(subscription.mandateId);
    }
    if (subscription) {
      invoices = await billing.invoices.listBySubscription(subscription.id);
    }
  }

  const plan = subscription ? billing.plans.get(subscription.planId) : undefined;
  const isActive = access.hasAccess;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Billing Portal</h1>
        <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>Customer: {customerId}</p>
      </header>

      {/* Access status */}
      <section style={card}>
        <h2 style={h2}>Access</h2>
        <Row label="Status">
          <span
            style={{
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: isActive ? "#dcfce7" : "#fee2e2",
              color: isActive ? "#166534" : "#991b1b"
            }}
          >
            {isActive ? "Active" : "No access"}
          </span>
        </Row>
        <Row label="Reason">{access.reason}</Row>
        <Row label="Access ends">{formatDate(access.accessEndsAt)}</Row>
        {access.graceEndsAt && access.graceEndsAt.getTime() > Date.now() && (
          <Row label="Grace until">{formatDate(access.graceEndsAt)}</Row>
        )}
      </section>

      {/* Subscription */}
      <section style={card}>
        <h2 style={h2}>Subscription</h2>
        {subscription ? (
          <>
            <Row label="Plan">{plan ? `${plan.name} (${formatPaise(plan.amount)} / ${plan.interval})` : subscription.planId}</Row>
            <Row label="Status">{subscription.status}</Row>
            <Row label="Current period">
              {formatDate(subscription.currentPeriodStart)} → {formatDate(subscription.currentPeriodEnd)}
            </Row>
            <Row label="Renews on">{formatDate(subscription.nextBillingAt)}</Row>
            {subscription.cancelAtPeriodEnd && (
              <Row label="Cancellation">
                <span style={{ color: "#b45309" }}>
                  Scheduled to cancel at period end ({formatDate(subscription.currentPeriodEnd)})
                </span>
              </Row>
            )}
          </>
        ) : (
          <p style={{ color: "#475569" }}>No active subscription.</p>
        )}
      </section>

      {/* Mandate */}
      <section style={card}>
        <h2 style={h2}>Payment method</h2>
        {mandate ? (
          <>
            <Row label="Method">{mandate.method}</Row>
            <Row label="Label">{mandate.safeInstrumentLabel ?? "—"}</Row>
            <Row label="Mandate status">{mandate.status}</Row>
            <Row label="Max amount">{formatPaise(mandate.maxAmount)}</Row>
          </>
        ) : (
          <p style={{ color: "#475569" }}>No mandate on file.</p>
        )}
      </section>

      {/* Invoices */}
      <section style={card}>
        <h2 style={h2}>Invoices</h2>
        {invoices.length === 0 ? (
          <p style={{ color: "#475569" }}>No invoices yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={th}>Reason</th>
                <th style={th}>Status</th>
                <th style={th}>Total</th>
                <th style={th}>Period</th>
                <th style={th}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={td}>{inv.reason}</td>
                  <td style={td}>{inv.status}</td>
                  <td style={td}>{formatPaise(inv.total)}</td>
                  <td style={td}>
                    {formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}
                  </td>
                  <td style={td}>{formatDate(inv.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Cancel */}
      {subscription && (
        <section style={card}>
          <h2 style={h2}>Cancel</h2>
          <p style={{ color: "#475569", fontSize: 13, marginBottom: 12 }}>
            Cancel at period end keeps access until {formatDate(subscription.currentPeriodEnd)}. Cancel now
            revokes access immediately and cancels the mandate.
          </p>
          <CancelButton subscriptionId={subscription.id} />
        </section>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/" style={{ color: "#4f46e5" }}>
          ← Back to pricing
        </Link>
      </p>
    </main>
  );
}

const card: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 20,
  background: "#fff",
  marginBottom: 16
};
const h2: CSSProperties = { margin: "0 0 12px", fontSize: 16 };
const th: CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: CSSProperties = { padding: "6px 8px" };

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}
