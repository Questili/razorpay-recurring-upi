/**
 * Thin Razorpay REST client. One method per API call the adapter needs, returning
 * typed parsed bodies. Throws {@link RazorpayHttpError} on non-2xx so the adapter
 * can map the error to a failure classification.
 */
import type { HttpTransport } from "./transport.js";
import type {
  RazorpayCreateAuthorizationResult,
  RazorpayCustomer,
  RazorpayOrder,
  RazorpayPayment,
  RazorpayToken
} from "./types.js";
import type { BillingMethod } from "@questili/razorpay-recurring-upi";

export interface CreateCustomerBody {
  name?: string | null;
  email?: string | null;
  contact?: string | null;
  notes?: Record<string, unknown>;
  fail_existing?: 0 | 1;
}

export interface CreateAuthorizationBody {
  customer_id: string;
  amount: number;
  currency: string;
  frequency: string;
  max_amount: number;
  expire_at?: number;
  notes?: Record<string, unknown>;
}

export interface CreateOrderBody {
  amount: number;
  currency: string;
  receipt?: string;
  notes?: Record<string, unknown>;
}

export interface CreateRecurringPaymentBody {
  token_id: string;
  amount: number;
  currency: string;
  contact: string;
  email: string;
  order_id: string;
  customer_id?: string;
  notes?: Record<string, unknown>;
}

export class RazorpayClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly methodEndpoint?: Partial<Record<BillingMethod, string>>
  ) {}

  async getCustomer(id: string): Promise<RazorpayCustomer> {
    const res = await this.transport.request("GET", `/customers/${encodeURIComponent(id)}`);
    return res.body as RazorpayCustomer;
  }

  async createCustomer(body: CreateCustomerBody): Promise<RazorpayCustomer> {
    const res = await this.transport.request("POST", "/customers", body);
    return res.body as RazorpayCustomer;
  }

  authorizationPath(method: BillingMethod): string {
    const segment = this.methodEndpoint?.[method] ?? method;
    return `/payments/recurring/${segment}/createAuthorization`;
  }

  async createAuthorization(method: BillingMethod, body: CreateAuthorizationBody): Promise<RazorpayCreateAuthorizationResult> {
    const res = await this.transport.request("POST", this.authorizationPath(method), body);
    return res.body as RazorpayCreateAuthorizationResult;
  }

  async fetchPayment(id: string): Promise<RazorpayPayment> {
    const res = await this.transport.request("GET", `/payments/${encodeURIComponent(id)}`);
    return res.body as RazorpayPayment;
  }

  async createOrder(body: CreateOrderBody): Promise<RazorpayOrder> {
    const res = await this.transport.request("POST", "/orders", body);
    return res.body as RazorpayOrder;
  }

  async createRecurringPayment(body: CreateRecurringPaymentBody): Promise<RazorpayPayment> {
    const res = await this.transport.request("POST", "/payments/create/recurring", body);
    return res.body as RazorpayPayment;
  }

  async fetchToken(id: string): Promise<RazorpayToken> {
    const res = await this.transport.request("GET", `/tokens/${encodeURIComponent(id)}`);
    return res.body as RazorpayToken;
  }

  async cancelToken(id: string): Promise<RazorpayToken> {
    const res = await this.transport.request("POST", `/tokens/${encodeURIComponent(id)}/cancel`);
    return res.body as RazorpayToken;
  }
}
