/**
 * Period / renewal scheduling. Adds calendar intervals (month / year) with
 * end-of-month clamping so a Jan 31 monthly subscription renews on Feb 28/29,
 * matching what a billing system and Razorpay mandate windows expect.
 */
import type { PlanInterval } from "../types/enums.js";

/** Days (ms). */
export const DAY_MS = 24 * 60 * 60 * 1000;

function clampDay(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay));
}

/** Add one billing interval to a date with month-end clamping. */
export function addInterval(date: Date, interval: PlanInterval): Date {
  const d = new Date(date.getTime());
  if (interval === "annual") {
    return clampDay(d.getFullYear() + 1, d.getMonth(), d.getDate());
  }
  return clampDay(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export interface Period {
  start: Date;
  end: Date;
}

/** The billing period that begins at `startAt` for the given plan interval. */
export function periodFor(startAt: Date, interval: PlanInterval): Period {
  return { start: new Date(startAt.getTime()), end: addInterval(startAt, interval) };
}

/** Remainder of a period as a fraction in [0,1]. Used by proration. */
export function remainingFraction(periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) return 0;
  const remaining = periodEnd.getTime() - now.getTime();
  if (remaining <= 0) return 0;
  if (remaining >= total) return 1;
  return remaining / total;
}
