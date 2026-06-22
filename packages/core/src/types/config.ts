/**
 * Configuration types for the public API facade and host-app wiring.
 */
import type { Clock } from "../clock.js";
import type { Logger } from "../logger.js";
import type { IdFactory } from "../ids.js";
import type { BillingStorage } from "../storage/types.js";
import type { RecurringPaymentProvider, ProviderName } from "../providers/types.js";
import type { BillingMethod, Currency, PlanInterval } from "./enums.js";

/** Plan definition supplied by the host app (code-config or loaded from storage). */
export interface BillingPlan {
  id: string;
  name: string;
  interval: PlanInterval;
  /** Subunits (paise). */
  amount: number;
  currency: Currency;
  features?: string[];
  metadata?: Record<string, string>;
}

/** SaaS billing policy. All money subunits. */
export interface BillingConfig {
  plans: BillingPlan[];
  /** Grace window after accessEndsAt during which past_due/payment_pending keep access. */
  gracePeriodDays: number;
  /** Default single-charge mandate cap if a host does not pass one explicitly. */
  defaultMandateMaxAmount: number;
  supportedMethods: BillingMethod[];
  /** Retry schedule (delay in ms between attempts) for retryable failures. */
  retryScheduleMs: number[];
  /** Authorization amount (subunits) used when registering a mandate. Usually the provider minimum. */
  defaultAuthorizationAmount: number;
  /** HMAC secret used to sign client-round-tripped plan-change preview tokens. */
  previewTokenSecret: string;
}

/** Providers registered with the facade, keyed by provider name. */
export type ProviderRegistry = Partial<Record<ProviderName, RecurringPaymentProvider>>;

/** Inputs to {@link createRazorpayRecurringUpiBilling}. */
export interface CreateBillingOptions {
  config: BillingConfig;
  storage: BillingStorage;
  providers: ProviderRegistry;
  clock?: Clock;
  logger?: Logger;
  idFactory?: IdFactory;
}
