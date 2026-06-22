/**
 * Normalized internal events emitted by the kit, plus operational hook contracts.
 *
 * Provider webhooks are normalized into these stable events so host apps react to
 * kit semantics ("invoice.paid") rather than provider event shapes. Host apps can
 * also subscribe to operational hooks for cron/queue integration and alerting.
 */
import type { FailureClass } from "./enums.js";
import type {
  BillingChargeAttempt,
  BillingInvoice,
  BillingMandate,
  BillingSubscription
} from "./records.js";

/** Discriminated union of normalized events. */
export type NormalizedBillingEvent =
  | { type: "mandate.authorized"; mandateId: string; customerId: string; at: Date }
  | { type: "mandate.expired"; mandateId: string; at: Date }
  | { type: "mandate.cancelled"; mandateId: string; at: Date }
  | { type: "mandate.paused"; mandateId: string; at: Date }
  | { type: "invoice.created"; invoiceId: string; subscriptionId: string; at: Date }
  | { type: "invoice.paid"; invoiceId: string; subscriptionId: string; at: Date }
  | { type: "invoice.payment_failed"; invoiceId: string; subscriptionId: string; failureClass: FailureClass; at: Date }
  | { type: "charge.captured"; chargeAttemptId: string; invoiceId: string; at: Date }
  | { type: "charge.pending"; chargeAttemptId: string; invoiceId: string; at: Date }
  | { type: "charge.failed"; chargeAttemptId: string; invoiceId: string; failureClass: FailureClass; at: Date }
  | { type: "subscription.activated"; subscriptionId: string; at: Date }
  | { type: "subscription.renewed"; subscriptionId: string; at: Date }
  | { type: "subscription.past_due"; subscriptionId: string; at: Date }
  | { type: "subscription.canceled"; subscriptionId: string; at: Date }
  | { type: "subscription.reauthorization_required"; subscriptionId: string; reason: string; at: Date };

/** Snapshot payload handed to operational hooks. */
export interface OperationalContext {
  invoice?: BillingInvoice;
  subscription?: BillingSubscription;
  mandate?: BillingMandate;
  chargeAttempt?: BillingChargeAttempt;
}

/** Host-supplied operational hook sink (queue enqueue, alert, metrics). */
export type OperationalHook = (event: NormalizedBillingEvent) => void | Promise<void>;

/** Subset of events a dunning/renewal scheduler reacts to. */
export type SchedulerAction =
  | { kind: "charge_renewal"; subscriptionId: string; idempotencyKey: string }
  | { kind: "retry_charge"; chargeAttemptId: string; idempotencyKey: string }
  | { kind: "reconcile_pending"; subscriptionId: string };
