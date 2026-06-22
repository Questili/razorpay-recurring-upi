/**
 * Failure classification (SPEC "Dunning and retries"). Maps a provider error /
 * charge outcome to one of four classes, which drives retry policy, mandate
 * reauthorization, and support escalation.
 *
 *  - retryable: temporary bank/PSP/timeout/insufficient funds -> retry per schedule.
 *  - reauthorization_required: mandate cancelled/expired/paused/invalid/blocked.
 *  - support_required: ambiguous processor state / reconciliation mismatch.
 *  - terminal: user revoked mandate or merchant canceled; never retry.
 *
 * Mapping is substring-based and overridable per host so non-Razorpay gateways
 * and new Razorpay codes can be added without code changes. Defaults are
 * intentionally optimistic (retryable) to avoid premature terminal decisions.
 */
import type { FailureClass } from "../types/enums.js";

export interface ProviderFailureInput {
  providerErrorCode?: string | null;
  providerErrorDescription?: string | null;
  providerStatus?: string | null;
  providerPaymentStatus?: string | null;
}

export interface FailureClassifierConfig {
  /** Substrings (lower-cased) that map a provider error to a class. */
  terminal: string[];
  reauthorization: string[];
  support: string[];
  retryable: string[];
  /** Fallback when nothing matches. */
  defaultClass: FailureClass;
}

export const DEFAULT_FAILURE_CONFIG: FailureClassifierConfig = {
  terminal: ["revoked", "revoked_by_user", "fraud", "merchant_canceled"],
  reauthorization: [
    "mandate",
    "token",
    "instrument",
    "blocked",
    "cancel",
    "expired",
    "expire",
    "paused",
    "inactive",
    "invalid"
  ],
  support: ["ambiguous", "reconcil", "support", "inconsistent", "unknown_state"],
  retryable: ["insufficient", "funds", "bank", "timeout", "timed out", "gateway", "network", "transient", "down", "psp", "declined"],
  defaultClass: "retryable"
};

export interface FailureClassification {
  class: FailureClass;
  matchedOn?: string;
}

export function classifyFailure(
  input: ProviderFailureInput,
  config: FailureClassifierConfig = DEFAULT_FAILURE_CONFIG
): FailureClassification {
  const haystack = [input.providerErrorCode, input.providerErrorDescription, input.providerStatus, input.providerPaymentStatus]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase();

  if (haystack.length === 0) {
    return { class: config.defaultClass };
  }

  // Precedence: terminal > reauthorization > support > retryable.
  const ordered: Array<{ klass: FailureClass; words: string[] }> = [
    { klass: "terminal", words: config.terminal },
    { klass: "reauthorization_required", words: config.reauthorization },
    { klass: "support_required", words: config.support },
    { klass: "retryable", words: config.retryable }
  ];

  for (const bucket of ordered) {
    for (const word of bucket.words) {
      if (haystack.includes(word)) {
        return { class: bucket.klass, matchedOn: word };
      }
    }
  }
  return { class: config.defaultClass };
}

/** Next retry timestamp for a retryable failure, or null if schedule exhausted. */
export function nextRetryAt(attemptNumber: number, retryScheduleMs: number[], now: Date): Date | null {
  // attemptNumber is 1-based and counts the attempts already made.
  const idx = attemptNumber - 1;
  if (idx < 0 || idx >= retryScheduleMs.length) return null;
  return new Date(now.getTime() + retryScheduleMs[idx]!);
}
