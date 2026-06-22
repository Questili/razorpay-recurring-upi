/**
 * Public facade factory. Wires storage, providers, clock, and logger into the
 * API namespaces. This is the single entrypoint host apps use:
 *
 *   const billing = createRazorpayRecurringUpiBilling({ config, storage, providers });
 *   await billing.mandates.createAuthorization({ ... });
 */
import { systemClock } from "../clock.js";
import { silentLogger } from "../logger.js";
import { randomIdFactory } from "../ids.js";
import { BillingError, invalidArgument } from "../errors.js";
import type { CreateBillingOptions } from "../types/config.js";
import type { BillingConfig, BillingPlan } from "../types/config.js";
import type { OperationalHook } from "../types/api.js";
import type { BillingContext } from "./context.js";
import { createCustomersApi } from "./customers.js";
import { createMandatesApi } from "./mandates.js";
import { createSubscriptionsApi } from "./subscriptions.js";
import { createRenewalsApi } from "./renewals.js";
import { createPlanChangesApi } from "./plan-changes.js";
import { createDiscountsApi } from "./discounts.js";
import { createInvoicesApi } from "./invoices.js";
import { createEntitlementApi } from "./entitlement.js";
import { createWebhooksApi } from "./webhooks.js";
import { createSchedulerApi } from "./scheduler.js";

export function validateConfig(config: BillingConfig): void {
  if (config.gracePeriodDays < 0) {
    throw invalidArgument("gracePeriodDays must be >= 0");
  }
  if (config.defaultMandateMaxAmount <= 0) {
    throw invalidArgument("defaultMandateMaxAmount must be > 0");
  }
  if (config.retryScheduleMs.some((d) => d < 0)) {
    throw invalidArgument("retryScheduleMs entries must be >= 0");
  }
  if (config.previewTokenSecret.trim().length < 32) {
    throw invalidArgument("previewTokenSecret must be at least 32 characters");
  }
  const seen = new Set<string>();
  for (const plan of config.plans) {
    if (seen.has(plan.id)) {
      throw invalidArgument(`Duplicate plan id: ${plan.id}`);
    }
    seen.add(plan.id);
    if (!Number.isInteger(plan.amount) || plan.amount < 0) {
      throw invalidArgument(`Plan ${plan.id} amount must be integer subunits >= 0`);
    }
  }
}

export interface Billing {
  config: BillingConfig;
  customers: ReturnType<typeof createCustomersApi>;
  mandates: ReturnType<typeof createMandatesApi>;
  subscriptions: ReturnType<typeof createSubscriptionsApi>;
  renewals: ReturnType<typeof createRenewalsApi>;
  planChanges: ReturnType<typeof createPlanChangesApi>;
  discounts: ReturnType<typeof createDiscountsApi>;
  invoices: ReturnType<typeof createInvoicesApi>;
  entitlement: ReturnType<typeof createEntitlementApi>;
  webhooks: ReturnType<typeof createWebhooksApi>;
  scheduler: ReturnType<typeof createSchedulerApi>;
  plans: {
    list(): BillingPlan[];
    get(id: string): BillingPlan | undefined;
  };
  onOperationalEvent(hook: OperationalHook): void;
  /** Internal context, exposed for advanced/host adapters. */
  readonly ctx: BillingContext;
}

export function createRazorpayRecurringUpiBilling(options: CreateBillingOptions): Billing {
  validateConfig(options.config);

  const ctx: BillingContext = {
    config: options.config,
    storage: options.storage,
    providers: options.providers,
    clock: options.clock ?? systemClock,
    logger: options.logger ?? silentLogger,
    id: options.idFactory ?? randomIdFactory,
    hooks: []
  };

  const customers = createCustomersApi(ctx);
  const mandates = createMandatesApi(ctx);
  const subscriptions = createSubscriptionsApi(ctx);
  const renewals = createRenewalsApi(ctx);
  const planChanges = createPlanChangesApi(ctx);
  const discounts = createDiscountsApi(ctx);
  const invoices = createInvoicesApi(ctx);
  const entitlement = createEntitlementApi(ctx);
  const webhooks = createWebhooksApi(ctx);
  const scheduler = createSchedulerApi(ctx, (opts) => renewals.runRenewals(opts));

  const billing: Billing = {
    config: options.config,
    customers,
    mandates,
    subscriptions,
    renewals,
    planChanges,
    discounts,
    invoices,
    entitlement,
    webhooks,
    scheduler,
    plans: {
      list: () => options.config.plans.map((p) => ({ ...p })),
      get: (id: string) => {
        const p = options.config.plans.find((x) => x.id === id);
        return p ? { ...p } : undefined;
      }
    },
    onOperationalEvent: (hook: OperationalHook) => {
      ctx.hooks.push(hook);
    },
    get ctx() {
      return ctx;
    }
  };

  return billing;
}

// Re-export the error type for host try/catch ergonomics.
export { BillingError };
