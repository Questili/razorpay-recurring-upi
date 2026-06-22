/**
 * Raw Razorpay API response shapes. Only the fields the adapter reads are typed;
 * everything else passes through opaquely. Razorpay may add fields, so these are
 * intentionally permissive (extra fields allowed via index signatures).
 */

export interface RazorpayCustomer {
  id: string;
  entity: "customer";
  name?: string | null;
  email?: string | null;
  contact?: string | null;
  notes?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RazorpayOrder {
  id: string;
  entity: "order";
  amount: number;
  amount_paid: number;
  currency: string;
  receipt?: string | null;
  status: "created" | "attempted" | "paid";
  notes?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RazorpayCreateAuthorizationResult {
  razorpay_order_id: string;
  razorpay_subscription_id?: string | null;
  [k: string]: unknown;
}

export interface RazorpayRecurringDetails {
  token_id?: string;
  [k: string]: unknown;
}

export interface RazorpayPayment {
  id: string;
  entity: "payment";
  status: string; // created | authorized | captured | failed | pending | refunded ...
  amount: number;
  currency: string;
  order_id?: string | null;
  method?: string;
  recurring?: string | null;
  recurring_details?: RazorpayRecurringDetails;
  token_id?: string;
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
  [k: string]: unknown;
}

export interface RazorpayToken {
  id: string;
  entity: "token";
  status: string; // created | active | paused | cancelled | expired ...
  method: string;
  max_amount?: number;
  expire_at?: number | null;
  recurring_details?: { max_amount?: number };
  [k: string]: unknown;
}

export interface RazorpayErrorBody {
  error: {
    code: string;
    description: string;
    field?: string | null;
    metadata?: Record<string, unknown>;
  };
  [k: string]: unknown;
}

/** Parsed Razorpay webhook event payload. */
export interface RazorpayWebhookPayload {
  entity: "event";
  event: string;
  account_id?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: Partial<RazorpayPayment> };
    refund?: { entity?: { id?: string; amount?: number } };
    token?: { entity?: Partial<RazorpayToken> };
  };
  [k: string]: unknown;
}
