/**
 * Generic string-state machine + concrete machines for the four stateful
 * entities (subscription, mandate, invoice, charge attempt). Transitions are
 * validated centrally so the API layer cannot place an entity in an illegal
 * state. Terminal states have empty successor lists.
 */
import { illegalTransition } from "../errors.js";
import type {
  ChargeAttemptStatus,
  InvoiceStatus,
  MandateStatus,
  SubscriptionStatus
} from "../types/enums.js";

export interface StateMachine<S extends string> {
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
  isTerminal(state: S): boolean;
}

export function defineStateMachine<S extends string>(
  allowed: Record<S, readonly S[]>
): StateMachine<S> {
  const terminals = (Object.keys(allowed) as S[]).filter((s) => allowed[s].length === 0);
  return {
    canTransition(from, to) {
      const succ = allowed[from];
      return Array.isArray(succ) && succ.includes(to);
    },
    assertTransition(from, to) {
      if (from === to) return;
      const succ = allowed[from];
      if (!Array.isArray(succ) || !succ.includes(to)) {
        throw illegalTransition("entity", from, to);
      }
    },
    isTerminal(state) {
      return terminals.includes(state);
    }
  };
}

export const subscriptionMachine = defineStateMachine<SubscriptionStatus>({
  draft: ["pending_authorization", "active", "canceled", "expired"],
  pending_authorization: ["active", "canceled", "expired", "draft"],
  active: [
    "past_due",
    "payment_pending",
    "reauthorization_required",
    "cancel_at_period_end",
    "canceled",
    "expired"
  ],
  past_due: ["active", "payment_pending", "reauthorization_required", "canceled", "expired"],
  payment_pending: ["active", "past_due", "reauthorization_required", "canceled", "expired"],
  reauthorization_required: ["active", "canceled", "expired"],
  cancel_at_period_end: ["active", "canceled", "past_due", "payment_pending", "reauthorization_required", "expired"],
  canceled: [],
  expired: []
});

export const mandateMachine = defineStateMachine<MandateStatus>({
  initiated: ["confirmed", "rejected", "unknown", "cancelled", "expired"],
  confirmed: ["paused", "cancelled", "expired", "unknown"],
  paused: ["confirmed", "cancelled", "expired", "unknown"],
  rejected: [],
  cancelled: [],
  expired: [],
  unknown: ["initiated", "confirmed", "paused", "cancelled", "expired", "rejected"]
});

export const invoiceMachine = defineStateMachine<InvoiceStatus>({
  draft: ["open", "void"],
  open: ["paid", "void", "uncollectible"],
  paid: [],
  void: [],
  uncollectible: ["open"]
});

export const chargeAttemptMachine = defineStateMachine<ChargeAttemptStatus>({
  scheduled: ["submitted", "captured", "failed_retryable", "failed_terminal", "reauthorization_required"],
  submitted: ["pending", "captured", "failed_retryable", "failed_terminal", "reauthorization_required"],
  pending: ["captured", "failed_retryable", "failed_terminal", "reauthorization_required"],
  captured: [],
  failed_retryable: ["scheduled", "submitted"],
  failed_terminal: [],
  reauthorization_required: []
});
