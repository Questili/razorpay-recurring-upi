/**
 * Money helpers. All amounts in the kit are integer subunits (paise for INR).
 * We never store floats; all division (proration, percent discounts) rounds to
 * the nearest paise using round-half-up so totals reconcile.
 */
import { BillingError } from "../errors.js";

export const ZERO = 0;

export function assertSubunits(amount: number, field = "amount"): number {
  if (!Number.isInteger(amount)) {
    throw new BillingError(
      "INVALID_ARGUMENT",
      `${field} must be an integer number of subunits, got ${amount}`,
      { field, amount }
    );
  }
  if (amount < 0) {
    throw new BillingError(
      "INVALID_ARGUMENT",
      `${field} must be non-negative, got ${amount}`,
      { field, amount }
    );
  }
  return amount;
}

/** Round-half-up to nearest integer (paise). Avoids float drift in JS Math.round. */
export function roundPaise(value: number): number {
  if (value >= 0) return Math.floor(value + 0.5);
  return Math.ceil(value - 0.5);
}

export function addSubunits(...amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + assertSubunits(n), 0);
}

export function subtractSubunits(a: number, b: number): number {
  return assertSubunits(a) - assertSubunits(b);
}

/** Divide subunits and round to nearest paise, preserving integer invariant. */
export function allocate(amount: number, numerator: number, denominator: number): number {
  assertSubunits(amount);
  if (denominator <= 0) {
    throw new BillingError("INVALID_ARGUMENT", `denominator must be positive, got ${denominator}`);
  }
  return roundPaise((amount * numerator) / denominator);
}

/** Sum signed line amounts, returning integer subunits (may be negative for credits). */
export function sumSigned(amounts: number[]): number {
  return amounts.reduce((acc, n) => {
    if (!Number.isInteger(n)) {
      throw new BillingError("INVALID_ARGUMENT", `line amount must be integer subunits, got ${n}`);
    }
    return acc + n;
  }, 0);
}

/** Format subunits as a debug string (e.g. 5000 -> "₹50.00"). Display only. */
export function formatForDisplay(amount: number, currency = "INR"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${sign}${symbol}${whole}.${String(frac).padStart(2, "0")}`;
}
