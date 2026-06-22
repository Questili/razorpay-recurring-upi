"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";

/**
 * Minimal cancel control for the portal. Posts to /api/billing/cancel and
 * refreshes the page so the server component re-renders with fresh state.
 */
export function CancelButton({ subscriptionId }: { subscriptionId: string }): JSX.Element {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function cancel(timing: "immediate" | "period_end"): void {
    setErr(null);
    startTransition(async () => {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscriptionId, timing })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(data.error ?? `cancel failed (${res.status})`);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        type="button"
        disabled={pending}
        onClick={() => cancel("period_end")}
        style={btn("#e2e8f0", "#0f172a")}
      >
        {pending ? "..." : "Cancel at period end"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => cancel("immediate")}
        style={btn("#fecaca", "#7f1d1d")}
      >
        Cancel now
      </button>
      {err && <span style={{ color: "#b91c1c", fontSize: 12 }}>{err}</span>}
    </div>
  );
}

function btn(bg: string, color: string): CSSProperties {
  return {
    padding: "8px 12px",
    background: bg,
    color,
    border: "none",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer"
  };
}
