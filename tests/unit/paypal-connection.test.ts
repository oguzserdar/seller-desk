/** REST contract controls with isolated responses. These are not actual PayPal sandbox proof. */
import { describe, expect, it, vi } from "vitest";
import { checkPayPalConnection, sandboxWebhookUrl } from "@/server/paypal/connection-check";
import type { PayPalConfig } from "@/server/env";

const config = { status: "ready" as const, clientId: "test-client", clientSecret: "secret-must-not-leak", merchantId: "MERCHANT", webhookId: "WEBHOOK" };
const origin = "https://shop.example";
const webhook = { id: "WEBHOOK", url: `${origin}/api/paypal/webhook`, event_types: [{ name: "CHECKOUT.ORDER.APPROVED" }, { name: "PAYMENT.CAPTURE.COMPLETED" }] };
const token = () => Response.json({ access_token: "token-must-not-leak", expires_in: 3600 });
function transport(responses: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected request");
    return response;
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("read-only sandbox connection check", () => {
  it("checks authentication and exact webhook registration without any order, capture or configuration write", async () => {
    const { fetcher, calls } = transport([token(), Response.json(webhook)]);
    expect(await checkPayPalConnection(config, origin, fetcher)).toMatchObject({ ok: true });
    expect(calls.map(({ url, init }) => [url, init?.method])).toEqual([
      ["https://api-m.sandbox.paypal.com/v1/oauth2/token", "POST"],
      ["https://api-m.sandbox.paypal.com/v1/notifications/webhooks/WEBHOOK", "GET"],
    ]);
    expect(calls.every(({ init }) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it.each([
    [{ status: "fixture" }, "fixture"],
    [{ status: "unavailable", missing: ["PAYPAL_CLIENT_ID"] }, "settings"],
  ] as const)("does not contact PayPal for an unconnected installation", async (settings, stage) => {
    const fetcher = vi.fn();
    expect(await checkPayPalConnection(settings as PayPalConfig, origin, fetcher)).toMatchObject({ ok: false, stage });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:4455", "https://localhost", "https://shop.example:8443", "https://shop.example/other"])("rejects unsupported callback origin %s before networking", async (address) => {
    const fetcher = vi.fn();
    expect(sandboxWebhookUrl(address)).toBeNull();
    expect(await checkPayPalConnection(config, address, fetcher)).toMatchObject({ ok: false, stage: "address" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...webhook, id: "OTHER" },
    { ...webhook, url: "https://another-shop.example/api/paypal/webhook" },
    { ...webhook, url: `${origin}/api/paypal/webhook?copy=wrong` },
    { ...webhook, event_types: [{ name: "CHECKOUT.ORDER.APPROVED" }] },
    { ...webhook, event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }] },
  ])("refuses mismatched or incomplete webhook registration", async (record) => {
    const { fetcher } = transport([token(), Response.json(record)]);
    expect(await checkPayPalConnection(config, origin, fetcher)).toMatchObject({ ok: false, stage: "webhook" });
  });

  it("accepts PayPal's documented all-events subscription", async () => {
    const { fetcher } = transport([token(), Response.json({ ...webhook, event_types: [{ name: "*" }] })]);
    expect(await checkPayPalConnection(config, origin, fetcher)).toMatchObject({ ok: true });
  });

  it("does not leak an echoed secret when OAuth rejects the keys", async () => {
    const { fetcher } = transport([Response.json({ message: config.clientSecret }, { status: 401 })]);
    const result = await checkPayPalConnection(config, origin, fetcher);
    expect(result).toMatchObject({ ok: false, stage: "authentication" });
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });

  it.each([403, 404])("explains a webhook that this app cannot read (%s), without echoing its body", async (status) => {
    const { fetcher } = transport([token(), Response.json({ name: config.clientSecret }, { status })]);
    const result = await checkPayPalConnection(config, origin, fetcher);
    expect(result).toMatchObject({ ok: false, stage: "webhook" });
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });

  it("retries a rejected token once, keeping the request read-only", async () => {
    const { fetcher, calls } = transport([token(), Response.json({}, { status: 401 }), token(), Response.json(webhook)]);
    expect(await checkPayPalConnection(config, origin, fetcher)).toMatchObject({ ok: true });
    expect(calls.map(({ init }) => init?.method)).toEqual(["POST", "GET", "POST", "GET"]);
  });

  it.each([Response.json({}), new Response("<html>not a webhook</html>")])("does not call an unreadable successful response connected", async (response) => {
    const { fetcher } = transport([token(), response]);
    expect(await checkPayPalConnection(config, origin, fetcher)).toMatchObject({ ok: false, stage: "response" });
  });

  it.each([429, 500])("does not retry an unavailable service (%s) or expose provider text", async (status) => {
    const { fetcher, calls } = transport([token(), Response.json({ message: config.clientSecret }, { status })]);
    const result = await checkPayPalConnection(config, origin, fetcher);
    expect(result).toMatchObject({ ok: false, stage: "unavailable" });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });

  it("turns network exceptions into a safe retry message", async () => {
    const { fetcher } = transport([new Error(config.clientSecret)]);
    const result = await checkPayPalConnection(config, origin, fetcher);
    expect(result).toMatchObject({ ok: false, stage: "unavailable" });
    expect(JSON.stringify(result)).not.toContain(config.clientSecret);
  });
});
