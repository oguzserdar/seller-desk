/**
 * PayPal Orders v2 over REST, sandbox only in this release.
 *
 * Every write carries a PayPal-Request-Id that was saved before the call, so a
 * retry after a lost response repeats the same operation. Timeouts, network
 * failures, 429 and 5xx become TransportUncertainError; other 4xx become
 * TransportRejectedError. Responses are validated before use.
 */
import { z } from "zod";
import {
  type CreateOrderRequest,
  type PayPalTransport,
  type ProviderOrder,
  TransportUncertainError,
} from "./types";

import { createSandboxClient } from "./sandbox-client";
export { SANDBOX_API_BASE } from "./sandbox-client";
/** The only external approval host accepted by the sandbox payment engine. */
export const SANDBOX_APPROVAL_HOSTS = ["www.sandbox.paypal.com"] as const;

const Money = z.looseObject({ currency_code: z.string(), value: z.string() });
const Capture = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: Money.optional(),
  final_capture: z.boolean().optional(),
});
const PurchaseUnit = z.looseObject({
  reference_id: z.string().optional(),
  custom_id: z.string().optional(),
  amount: Money.optional(),
  payee: z.looseObject({ merchant_id: z.string().optional() }).optional(),
  payments: z.looseObject({ captures: z.array(Capture).max(1).optional() }).optional(),
});
const OrderBody = z.looseObject({
  id: z.string(),
  status: z.string(),
  links: z.array(z.looseObject({ href: z.string(), rel: z.string() })).optional(),
  purchase_units: z.array(PurchaseUnit).max(1).optional(),
  payer: z
    .looseObject({
      name: z.looseObject({ given_name: z.string().optional(), surname: z.string().optional() }).optional(),
      email_address: z.string().optional(),
    })
    .optional(),
});
const VerifyBody = z.looseObject({ verification_status: z.string() });

/** Server-held credentials and merchant identity for one sandbox shop. */
export type LivePayPalConfig = { clientId: string; clientSecret: string; merchantId: string; webhookId: string };

function providerResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  // A successful HTTP status does not prove a readable or supported result.
  // A write may already have happened; keep the original idempotency key and
  // let the engine's existing uncertainty/reconciliation path decide.
  if (!parsed.success) throw new TransportUncertainError("PayPal returned an unreadable or unsupported response", "invalid_response");
  return parsed.data;
}

/** Turns a validated Orders v2 body into the app's ProviderOrder. Exported for contract tests. */
export function normalizeSandboxOrder(body: unknown): ProviderOrder {
  const order = providerResponse(OrderBody, body);
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const approval = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve");
  const payerName = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ");
  return {
    environment: "sandbox",
    id: order.id,
    status: order.status,
    approvalUrl: approval?.href ?? null,
    referenceId: unit?.reference_id ?? null,
    customId: unit?.custom_id ?? null,
    amount: unit?.amount ? { value: unit.amount.value, currency: unit.amount.currency_code } : null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
    capture: capture
      ? {
          id: capture.id,
          status: capture.status,
          amount: capture.amount ? { value: capture.amount.value, currency: capture.amount.currency_code } : null,
          finalCapture: capture.final_capture ?? null,
        }
      : null,
    payer: { name: payerName || null, email: order.payer?.email_address ?? null },
  };
}

/** Builds the Orders v2 create body. Exported so tests can pin the exact request shape. */
export function buildCreateOrderBody(request: CreateOrderRequest) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: request.referenceId,
        custom_id: request.attemptId,
        invoice_id: request.attemptId,
        description: request.description.slice(0, 127),
        amount: {
          currency_code: request.amount.currency,
          value: request.amount.value,
          breakdown: { item_total: { currency_code: request.amount.currency, value: request.amount.value } },
        },
        payee: { merchant_id: request.payeeMerchantId },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: request.brandName.slice(0, 127),
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: request.returnUrl,
          cancel_url: request.cancelUrl,
        },
      },
    },
  };
}

/** Creates the REST adapter; injected fetch is used only by isolated contract tests. */
export function createSandboxTransport(config: LivePayPalConfig, fetchImpl: typeof fetch = fetch): PayPalTransport {
  const { call } = createSandboxClient(config, fetchImpl);

  return {
    environment: "sandbox",
    approvalHosts: SANDBOX_APPROVAL_HOSTS,

    async createOrder(request, signal) {
      const json = await call("POST", "/v2/checkout/orders", {
        body: JSON.stringify(buildCreateOrderBody(request)),
        requestId: request.requestId,
        signal,
      });
      return normalizeSandboxOrder(json);
    },

    async getOrder(orderId, signal) {
      return normalizeSandboxOrder(await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { signal }));
    },

    async captureOrder(orderId, requestId, signal) {
      const json = await call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        body: "{}",
        requestId,
        signal,
      });
      return normalizeSandboxOrder(json);
    },

    async verifyWebhook({ headers, rawBody }) {
      const fields = {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: config.webhookId,
      };
      if (Object.values(fields).some((value) => !value)) return false;
      try {
        JSON.parse(rawBody);
      } catch {
        return false;
      }
      // The event is embedded byte-for-byte; re-serializing it can change what PayPal signed.
      const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
      const json = await call("POST", "/v1/notifications/verify-webhook-signature", { body });
      return providerResponse(VerifyBody, json).verification_status === "SUCCESS";
    },
  };
}
