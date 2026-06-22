/**
 * Typed error hierarchy. The kit fails fast on contract violations and returns
 * discriminated results for business outcomes (charges, plan changes). Errors
 * carry a stable `code` so host apps can map them to HTTP responses and UI.
 */
export type BillingErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ILLEGAL_TRANSITION"
  | "MANDATE_INACTIVE"
  | "MANDATE_CAP_EXCEEDED"
  | "OVERLAPPING_DEBIT"
  | "PROVIDER_ERROR"
  | "WEBHOOK_VERIFICATION_FAILED"
  | "CONFIG_ERROR"
  | "UNSUPPORTED";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly details?: Record<string, unknown>;
  override readonly name = "BillingError";

  constructor(code: BillingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    if (details) this.details = details;
  }
}

export function isBillingError(e: unknown): e is BillingError {
  return e instanceof BillingError;
}

export const illegalTransition = (entity: string, from: string, to: string): BillingError =>
  new BillingError(
    "ILLEGAL_TRANSITION",
    `Illegal ${entity} transition: ${from} -> ${to}`,
    { entity, from, to }
  );

export const notFound = (entity: string, id: string): BillingError =>
  new BillingError("NOT_FOUND", `${entity} not found: ${id}`, { entity, id });

export const invalidArgument = (message: string, details?: Record<string, unknown>): BillingError =>
  new BillingError("INVALID_ARGUMENT", message, details);
