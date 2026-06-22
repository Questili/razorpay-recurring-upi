/**
 * HTTP transport abstraction. The default implementation uses global fetch; tests
 * inject a fake transport to exercise the adapter without network. Centralizing
 * I/O here keeps the adapter logic pure and deterministic under test.
 */
import type { RazorpayErrorBody } from "./types.js";

export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface HttpTransport {
  request(method: "GET" | "POST", path: string, body?: object): Promise<TransportResponse>;
}

export class RazorpayHttpError extends Error {
  readonly status: number;
  readonly errorBody: RazorpayErrorBody | null;
  override readonly name = "RazorpayHttpError";
  constructor(status: number, message: string, errorBody: RazorpayErrorBody | null) {
    super(message);
    this.status = status;
    this.errorBody = errorBody;
  }
}

export function isRazorpayErrorBody(x: unknown): x is RazorpayErrorBody {
  return !!x && typeof x === "object" && "error" in (x as Record<string, unknown>);
}

/** Builds a fetch-based transport with HTTP Basic auth (keyId:keySecret). */
export function createFetchTransport(baseUrl: string, keyId: string, keySecret: string): HttpTransport {
  const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return {
    async request(method, path, body) {
      const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
      const init: RequestInit = {
        method,
        headers: { Authorization: auth, "Content-Type": "application/json" }
      };
      if (body && method !== "GET") {
        init.body = JSON.stringify(body);
      }
      const res = await fetch(url, init);
      const text = await res.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        const errorBody = isRazorpayErrorBody(parsed) ? parsed : null;
        const code = errorBody?.error.code ?? `HTTP_${res.status}`;
        const desc = errorBody?.error.description ?? text;
        throw new RazorpayHttpError(res.status, `${code}: ${desc}`, errorBody);
      }
      return { status: res.status, body: parsed };
    }
  };
}
