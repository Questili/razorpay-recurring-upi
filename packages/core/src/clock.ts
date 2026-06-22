/**
 * Clock abstraction. The entire kit reads "now" from an injected {@link Clock}
 * so renewal scheduling, proration, grace windows, and idempotency timing are
 * deterministic in tests. Host apps that want real time pass {@link systemClock}.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  }
};

/** Fixed clock for deterministic tests and replay. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
