import { toProviderValue } from "@/lib/money";
import type { PolicySnapshot, QuoteLine } from "@/server/db/types";
import type { CreateOrderRequest } from "@/server/paypal/types";

/** Builds the deterministic PayPal create payload from the reviewed quote snapshot. */
export function buildCreateRequest(input: {
  attemptId: string;
  createRequestId: string;
  quoteRow: { id: string; revision: number; lines: QuoteLine[]; policySnapshot: PolicySnapshot };
  amountMinor: number;
  currency: string;
  payeeMerchantId: string;
  appUrl: string;
}): CreateOrderRequest {
  const titles = input.quoteRow.lines.map((line) => `${line.quantity} x ${line.title}`).join(", ");
  return {
    requestId: input.createRequestId,
    referenceId: input.quoteRow.id,
    attemptId: input.attemptId,
    description: `${input.quoteRow.policySnapshot.sellerName}: ${titles}`,
    amount: { value: toProviderValue(input.amountMinor, input.currency), currency: input.currency },
    payeeMerchantId: input.payeeMerchantId,
    brandName: input.quoteRow.policySnapshot.sellerName,
    returnUrl: `${input.appUrl}/checkout/return?attempt=${input.attemptId}`,
    cancelUrl: `${input.appUrl}/checkout/cancel?attempt=${input.attemptId}`,
  };
}

