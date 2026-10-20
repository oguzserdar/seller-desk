import { z } from "zod";
import { parseExactOrigin } from "@/lib/origin";
import type { PayPalConfig } from "@/server/env";
import { createSandboxClient } from "./sandbox-client";
import { TransportRejectedError } from "./types";

/** Events used for buyer-approved capture and independent capture reconciliation. */
export const PAYPAL_CHECKOUT_EVENTS = ["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"] as const;
const Webhook = z.object({
  id: z.string(), url: z.string(), event_types: z.array(z.object({ name: z.string() })).max(1000),
});

/** Safe diagnostic output; never contains credentials, tokens or raw provider errors. */
export type PayPalConnectionCheck =
  | { ok: true; checkedAt: string }
  | { ok: false; stage: "fixture" | "settings" | "address" | "authentication" | "webhook" | "response" | "unavailable"; problem: string };

/** Returns the expected HTTPS listener address, without claiming it is reachable. */
export function sandboxWebhookUrl(appUrl: string): string | null {
  const origin = parseExactOrigin(appUrl);
  if (!origin) return null;
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.port || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost")) return null;
  return `${origin}/api/paypal/webhook`;
}

/** Checks app authentication and webhook registration without creating orders or changing PayPal. */
export async function checkPayPalConnection(config: PayPalConfig, appUrl: string, fetchImpl: typeof fetch = fetch): Promise<PayPalConnectionCheck> {
  if (config.status === "fixture") return { ok: false, stage: "fixture", problem: "This installation simulates payments. Set up a separate sandbox installation to connect to PayPal." };
  if (config.status !== "ready") return { ok: false, stage: "settings", problem: "Add the four PayPal sandbox settings on your server, then restart or redeploy and check again." };
  const expectedUrl = sandboxWebhookUrl(appUrl);
  if (!expectedUrl) return { ok: false, stage: "address", problem: "PayPal needs a hosted HTTPS address on port 443. Set APP_URL to that address before checking the webhook." };
  try {
    const { call } = createSandboxClient(config, fetchImpl);
    const body = await call("GET", `/v1/notifications/webhooks/${encodeURIComponent(config.webhookId)}`, { signal: AbortSignal.timeout(20_000) });
    const parsed = Webhook.safeParse(body);
    if (!parsed.success) return { ok: false, stage: "response", problem: "PayPal returned an unreadable webhook record. Try the check again." };
    if (parsed.data.id !== config.webhookId || parsed.data.url !== expectedUrl) {
      return { ok: false, stage: "webhook", problem: "The webhook does not match this installation. Use the webhook ID and exact listener address shown in the server setup steps." };
    }
    const events = new Set(parsed.data.event_types.map((event) => event.name));
    if (!events.has("*") && !PAYPAL_CHECKOUT_EVENTS.every((event) => events.has(event))) {
      return { ok: false, stage: "webhook", problem: "Subscribe this webhook to both CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED, then check again." };
    }
    return { ok: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof TransportRejectedError) {
      if (error.status === 401 || error.issue === "AUTHENTICATION_FAILURE") return { ok: false, stage: "authentication", problem: "PayPal rejected the app credentials. Copy the Client ID and Secret from the same Sandbox app, then restart or redeploy." };
      if (error.status === 403 || error.status === 404) return { ok: false, stage: "webhook", problem: "This app cannot read that webhook. Check the webhook ID belongs to the same Sandbox app as the Client ID and Secret." };
    }
    return { ok: false, stage: "unavailable", problem: "The PayPal check could not finish. Try again in a moment. No payment was attempted." };
  }
}
