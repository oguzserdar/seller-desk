import type { Environment } from "@/server/db/types";

export type ProviderMoney = { value: string; currency: string };

export type ProviderCapture = {
  id: string;
  status: string;
  amount: ProviderMoney | null;
  finalCapture: boolean | null;
};

/** The parts of a PayPal Orders v2 order this app relies on, normalized. */
export type ProviderOrder = {
  environment: Environment;
  id: string;
  status: string;
  approvalUrl: string | null;
  referenceId: string | null;
  customId: string | null;
  amount: ProviderMoney | null;
  payeeMerchantId: string | null;
  capture: ProviderCapture | null;
  payer: { name: string | null; email: string | null };
};

export type CreateOrderRequest = {
  /** Stable PayPal-Request-Id, saved before the call and reused on every retry. */
  requestId: string;
  /** Our quote id, echoed back as purchase_units[0].reference_id. */
  referenceId: string;
  /** Our payment attempt id, sent as custom_id and invoice_id. */
  attemptId: string;
  description: string;
  amount: ProviderMoney;
  payeeMerchantId: string;
  brandName: string;
  returnUrl: string;
  cancelUrl: string;
};

/**
 * One implementation per environment, selected once from APP_MODE.
 * There is no runtime fallback between them.
 */
export interface PayPalTransport {
  readonly environment: Environment;
  /** Hosts an approval link may point to; anything else is refused. */
  readonly approvalHosts: readonly string[];
  createOrder(request: CreateOrderRequest, signal?: AbortSignal): Promise<ProviderOrder>;
  getOrder(orderId: string, signal?: AbortSignal): Promise<ProviderOrder>;
  captureOrder(orderId: string, requestId: string, signal?: AbortSignal): Promise<ProviderOrder>;
  verifyWebhook(input: { headers: Headers; rawBody: string }): Promise<boolean>;
}

/** The call may or may not have taken effect (timeout, network loss, 5xx, 429). Never treat as failed. */
export class TransportUncertainError extends Error {
  override name = "TransportUncertainError";
  constructor(
    message: string,
    public readonly detail: string,
  ) {
    super(message);
  }
}

/** PayPal definitively refused the request (4xx); the effect did not happen. */
export class TransportRejectedError extends Error {
  override name = "TransportRejectedError";
  constructor(
    message: string,
    public readonly status: number,
    public readonly issue: string | null,
  ) {
    super(message);
  }
}
