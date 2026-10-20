import type { Environment } from "@/server/db/types";
import type { BuyerPrincipal } from "@/server/domain/principal";

/** The exact quote revision the authenticated buyer reviewed. */
export type CheckoutInput = { quoteId: string; revision: number };

/** Trusted installation configuration, resolved before entering the database operation. */
export type CheckoutContext = { environment: Environment; payeeMerchantId: string; appUrl: string };

/**
 * One atomic operation: validate scope and revision, reserve goods, accept the quote,
 * and persist one payment intent plus audit. No provider call runs inside this operation.
 */
export type CheckoutStorage = {
  holdAndRecord(buyer: BuyerPrincipal, input: CheckoutInput, context: CheckoutContext): Promise<string>;
};
