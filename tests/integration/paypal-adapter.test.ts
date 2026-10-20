/** Deterministic REST contract controls. No request is sent to PayPal. */
import { describe, expect, it, vi } from "vitest";
import { buildCreateOrderBody, createSandboxTransport, normalizeSandboxOrder, SANDBOX_API_BASE } from "@/server/paypal/live";
import { type CreateOrderRequest, TransportRejectedError, TransportUncertainError } from "@/server/paypal/types";

const config = { clientId: "test-client", clientSecret: "test-secret", merchantId: "MERCHANT", webhookId: "WEBHOOK" };
const request: CreateOrderRequest = {
  requestId: "stable-create-id", referenceId: "QUOTE", attemptId: "ATTEMPT", description: "Mug", amount: { value: "35.00", currency: "CAD" },
  payeeMerchantId: "MERCHANT", brandName: "Test shop", returnUrl: "https://shop.example/return", cancelUrl: "https://shop.example/cancel",
};
const order = {
  id: "ORDER", status: "COMPLETED", purchase_units: [{ reference_id: "QUOTE", custom_id: "ATTEMPT", amount: { value: "35.00", currency_code: "CAD" },
    payee: { merchant_id: "MERCHANT" }, payments: { captures: [{ id: "CAPTURE", status: "COMPLETED", amount: { value: "35.00", currency_code: "CAD" }, final_capture: true }] } }],
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
function transport(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const response = responses.shift();
    if (!response) throw new Error("Unexpected test request");
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { api: createSandboxTransport(config, fetcher), calls };
}
const token = () => json({ access_token: "test-token", expires_in: 3600 });

describe("sandbox REST adapter, isolated from the network", () => {
  it("does not request credentials or create an order after its work budget ended", async () => {
    const { api, calls } = transport([token(), json(order)]);
    await expect(api.createOrder(request, AbortSignal.abort())).rejects.toBeInstanceOf(TransportUncertainError);
    expect(calls).toHaveLength(0);
  });

  it("combines the caller deadline with the HTTP timeout during a capture", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/token")) return token();
      controller.abort();
      if (init?.signal?.aborted) throw new DOMException("Stopped", "AbortError");
      return json(order);
    });
    const api = createSandboxTransport(config, fetcher as typeof fetch);
    await expect(api.captureOrder("ORDER", "stable-capture-id", controller.signal)).rejects.toMatchObject({ name: "TransportUncertainError", detail: "aborted" });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("PayPal-Request-Id")).toBe("stable-capture-id");
  });

  it("refreshes a rejected token once and preserves the capture idempotency key", async () => {
    const { api, calls } = transport([token(), json({}, 401), token(), json(order)]);
    expect((await api.captureOrder("ORDER", "stable-capture-id")).capture?.id).toBe("CAPTURE");
    expect(calls.map((call) => call.url)).toEqual([`${SANDBOX_API_BASE}/v1/oauth2/token`, `${SANDBOX_API_BASE}/v2/checkout/orders/ORDER/capture`, `${SANDBOX_API_BASE}/v1/oauth2/token`, `${SANDBOX_API_BASE}/v2/checkout/orders/ORDER/capture`]);
    for (const index of [1, 3]) {
      expect(new Headers(calls[index]!.init.headers).get("PayPal-Request-Id")).toBe("stable-capture-id");
      expect(calls[index]!.init.body).toBe("{}");
    }
  });

  it.each([429, 500, 503])("keeps HTTP %s uncertain rather than declaring the purchase failed", async (status) => {
    const { api } = transport([token(), json({}, status)]);
    await expect(api.createOrder(request)).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it("preserves PayPal's explicit rejection reason", async () => {
    const { api } = transport([token(), json({ details: [{ issue: "INSTRUMENT_DECLINED" }] }, 422)]);
    await expect(api.captureOrder("ORDER", "capture-id")).rejects.toMatchObject({ name: TransportRejectedError.name, issue: "INSTRUMENT_DECLINED", status: 422 });
  });

  it.each([new Response("<html>interrupted</html>"), json({ id: "ORDER" })])("treats an unreadable successful write response as uncertain", async (response) => {
    const { api } = transport([token(), response]);
    await expect(api.createOrder(request)).rejects.toBeInstanceOf(TransportUncertainError);
  });

  it("does not silently accept only the first purchase unit or capture", () => {
    const extraUnit = structuredClone(order);
    extraUnit.purchase_units.push(structuredClone(extraUnit.purchase_units[0]!));
    expect(() => normalizeSandboxOrder(extraUnit)).toThrow(TransportUncertainError);
    const extraCapture = structuredClone(order);
    extraCapture.purchase_units[0]!.payments.captures.push({ ...extraCapture.purchase_units[0]!.payments.captures[0]!, id: "SECOND" });
    expect(() => normalizeSandboxOrder(extraCapture)).toThrow(TransportUncertainError);
    expect(normalizeSandboxOrder(order)).toMatchObject({ id: "ORDER", amount: request.amount, payeeMerchantId: "MERCHANT", capture: { id: "CAPTURE", amount: request.amount } });
  });

  it("builds a single fixed-price order and sends its stable request id", async () => {
    const { api, calls } = transport([token(), json(order)]);
    await api.createOrder(request);
    const body = buildCreateOrderBody(request);
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0]).toMatchObject({ custom_id: "ATTEMPT", reference_id: "QUOTE", payee: { merchant_id: "MERCHANT" }, amount: { value: "35.00", currency_code: "CAD" } });
    expect(body.payment_source.paypal.experience_context).toMatchObject({ user_action: "PAY_NOW", return_url: request.returnUrl });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual(body);
    expect(new Headers(calls[1]!.init.headers).get("PayPal-Request-Id")).toBe(request.requestId);
  });

  it("requires all signature fields, preserves the event, and trusts only verification SUCCESS", async () => {
    const { api, calls } = transport([token(), json({ verification_status: "FAILURE" }), json({ verification_status: "SUCCESS" })]);
    const rawBody = '{ "id": "EVENT", "resource": { "value": 35.00 } }';
    const headers = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-transmission-id": "T", "paypal-transmission-sig": "S", "paypal-transmission-time": "2026-10-09T00:00:00Z" });
    expect(await api.verifyWebhook({ headers: new Headers(), rawBody })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await api.verifyWebhook({ headers, rawBody })).toBe(false);
    expect(await api.verifyWebhook({ headers, rawBody })).toBe(true);
    expect(calls[1]!.init.body).toContain(`"webhook_event":${rawBody}`);
    expect(JSON.parse(calls[1]!.init.body as string).webhook_id).toBe(config.webhookId);
  });
});
