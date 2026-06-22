/**
 * Internal shared context handed to every API namespace. Centralizes storage,
 * providers, config, clock, logger, id generation, and the operational-event
 * hook bus. API modules are pure functions over this context — they never hold
 * their own state.
 */
import type { BillingError } from "../errors.js";
import type { Clock } from "../clock.js";
import type { Logger } from "../logger.js";
import type { IdFactory } from "../ids.js";
import type { BillingConfig, BillingPlan, ProviderRegistry } from "../types/config.js";
import type { NormalizedBillingEvent } from "../types/events.js";
import type { BillingStorage } from "../storage/types.js";
import type { ProviderName, RecurringPaymentProvider } from "../providers/types.js";

export interface BillingContext {
  config: BillingConfig;
  storage: BillingStorage;
  providers: ProviderRegistry;
  clock: Clock;
  logger: Logger;
  id: IdFactory;
  hooks: Array<(event: NormalizedBillingEvent) => void | Promise<void>>;
}

export function getProvider(ctx: BillingContext, name: ProviderName): RecurringPaymentProvider {
  const provider = ctx.providers[name];
  if (!provider) {
    const err: BillingError = {
      code: "CONFIG_ERROR",
      message: `Provider "${name}" is not registered`,
      name: "BillingError"
    } as BillingError;
    throw err;
  }
  return provider;
}

export async function requirePlan(ctx: BillingContext, planId: string): Promise<BillingPlan> {
  // Plans can live in code (config) or storage. Code-config wins as the source
  // of truth so hosts can version plans without a migration. A stored plan is
  // assignable to the config BillingPlan shape (superset of fields).
  const fromConfig = ctx.config.plans.find((p) => p.id === planId);
  if (fromConfig) return snapshotPlan(fromConfig);
  const stored = await ctx.storage.getPlan(planId);
  if (stored) return stored;
  throw { code: "NOT_FOUND", message: `Plan not found: ${planId}`, name: "BillingError" } as BillingError;
}

function snapshotPlan(p: BillingPlan): BillingPlan {
  return { ...p, features: [...(p.features ?? [])], metadata: { ...(p.metadata ?? {}) } };
}

export async function emit(ctx: BillingContext, event: NormalizedBillingEvent): Promise<void> {
  for (const hook of ctx.hooks) {
    try {
      await hook(event);
    } catch (err) {
      // A failing hook must not break the billing flow; log and continue.
      ctx.logger.error("operational hook failed", { event: event.type, error: String(err) });
    }
  }
}
