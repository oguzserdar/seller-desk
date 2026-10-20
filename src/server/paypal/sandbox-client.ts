import { z } from "zod";
import { TransportRejectedError, TransportUncertainError } from "./types";

/** Fixed API origin; this release never selects PayPal production. */
export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
const REQUEST_TIMEOUT_MS = 15_000;

const ErrorBody = z.looseObject({
  name: z.string().optional(),
  message: z.string().optional(),
  details: z.array(z.looseObject({ issue: z.string().optional() })).optional(),
});
const TokenBody = z.looseObject({ access_token: z.string(), expires_in: z.number() });
function providerResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  // A successful HTTP status does not prove a readable or supported result.
  // A write may already have happened; keep the original idempotency key and
  // let the engine's existing uncertainty/reconciliation path decide.
  if (!parsed.success) throw new TransportUncertainError("PayPal returned an unreadable or unsupported response", "invalid_response");
  return parsed.data;
}

type TokenState = { token: string; expiresAt: number };

/** Authenticated requests to the fixed sandbox API, with bounded requests and one token refresh. */
export function createSandboxClient(config: { clientId: string; clientSecret: string }, fetchImpl: typeof fetch = fetch) {
  let cachedToken: TokenState | null = null;

  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      return await fetchImpl(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (error) {
      const detail = signal?.aborted ? "aborted" : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
      throw new TransportUncertainError("PayPal did not answer in time", detail);
    }
  }

  async function accessToken(forceRefresh = false, signal?: AbortSignal): Promise<string> {
    // An optimization only: correctness never depends on this cache surviving.
    if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
    const response = await send(`${SANDBOX_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }, signal);
    if (response.status >= 500 || response.status === 429) throw new TransportUncertainError("PayPal sign-in unavailable", "server");
    if (!response.ok) throw new TransportRejectedError("PayPal rejected the app credentials", response.status, "AUTHENTICATION_FAILURE");
    const body = providerResponse(TokenBody, await response.json().catch(() => null));
    cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async function call(method: "GET" | "POST", path: string, options: { body?: string; requestId?: string; signal?: AbortSignal } = {}) {
    let token = await accessToken(false, options.signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
      if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
      const response = await send(`${SANDBOX_API_BASE}${path}`, { method, headers, body: options.body }, options.signal);
      if (response.status === 401 && attempt === 0) {
        token = await accessToken(true, options.signal);
        continue;
      }
      if (response.status >= 500 || response.status === 429) {
        throw new TransportUncertainError(`PayPal returned ${response.status}`, "server");
      }
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = ErrorBody.safeParse(json);
        const issue = parsed.success ? (parsed.data.details?.[0]?.issue ?? parsed.data.name ?? null) : null;
        throw new TransportRejectedError(`PayPal refused the request (${issue ?? response.status})`, response.status, issue);
      }
      return json;
    }
    throw new TransportRejectedError("PayPal rejected the app credentials", 401, "AUTHENTICATION_FAILURE");
  }

  return { call };
}
