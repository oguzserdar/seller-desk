/**
 * Deterministic quote pricing. The model never supplies a price, total, charge
 * or availability: it can only name offers and quantities, and this function
 * decides what they cost and whether checkout may start.
 */
import { formatMoney } from "@/lib/money";
import type { PolicySnapshot, QuoteCharge, QuoteLine, Unresolved } from "@/server/db/types";
import { availableUnits, type InventoryRow, type OfferRow } from "./offers";

export type QuoteRequestLine = { offerId: string; quantity: number };

export type PricingInput = {
  sellerCurrency: string;
  policy: PolicySnapshot;
  lines: QuoteRequestLine[];
  offers: ReadonlyMap<string, { offer: OfferRow; stock: InventoryRow | undefined }>;
  budgetMinor: number | null;
  deliveryRequested: boolean;
  buyerNote?: string | null;
  scopeApproved: boolean;
  sellerPrices?: ReadonlyMap<string, number>;
};

export type PricedQuote = {
  lines: QuoteLine[];
  charges: QuoteCharge[];
  unresolved: Unresolved[];
  subtotalMinor: number | null;
  totalMinor: number | null;
  currency: string;
  status: "review_ready" | "needs_information" | "seller_review";
  reviewReason: string | null;
};

/** The request itself is invalid (unknown offer, duplicate line, quantity over the limit). */
export class PricingRejection extends Error {
  override name = "PricingRejection";
}

/** Prices published offers and holds custom services for a seller decision. */
export function priceQuote(input: PricingInput): PricedQuote {
  const lines: QuoteLine[] = [];
  const unresolved: Unresolved[] = [];
  const seen = new Set<string>();
  let needsScopeReview = false;

  for (const request of input.lines) {
    if (seen.has(request.offerId)) throw new PricingRejection("Each offer can appear only once in a quote.");
    seen.add(request.offerId);
    const entry = input.offers.get(request.offerId);
    if (!entry || !entry.offer.published) throw new PricingRejection("That offer is not available.");
    const { offer, stock } = entry;
    if (request.quantity > offer.maxQuantity) {
      throw new PricingRejection(`You can order up to ${offer.maxQuantity} of ${offer.title}.`);
    }
    const unitAmountMinor = offer.unitAmountMinor ?? (input.scopeApproved ? input.sellerPrices?.get(offer.id) ?? null : null);
    const lineTotalMinor = unitAmountMinor === null ? null : unitAmountMinor * request.quantity;
    if (lineTotalMinor !== null && !Number.isSafeInteger(lineTotalMinor)) throw new PricingRejection("That quantity is too large.");
    lines.push({
      offerId: offer.id,
      offerRevision: offer.revision,
      kind: offer.kind,
      title: offer.title,
      unitAmountMinor,
      quantity: request.quantity,
      lineTotalMinor,
      fulfillmentNote: offer.fulfillmentNote,
    });
    if (offer.currency !== input.sellerCurrency) {
      unresolved.push({ code: "currency_unsupported", message: `${offer.title} is priced in another currency.`, offerId: offer.id });
    }
    if (offer.kind === "goods") {
      const available = availableUnits(stock) ?? 0;
      if (request.quantity > available) {
        unresolved.push({
          code: "quantity_unavailable",
          message: available === 0 ? `${offer.title} is sold out.` : `Only ${available} ${offer.title} left.`,
          offerId: offer.id,
        });
      }
    }
    if (offer.kind === "service" && offer.requiresScopeReview && (!input.scopeApproved || unitAmountMinor === null)) needsScopeReview = true;
  }

  if (lines.some((line) => line.unitAmountMinor === null) && (input.buyerNote?.trim().length ?? 0) < 3) {
    unresolved.push({ code: "details_needed", message: "Describe the work so the seller can give you an accurate quote." });
  }

  const kinds = new Set(lines.map((line) => line.kind));
  const charges: QuoteCharge[] = [];
  const { policy } = input;

  if (!policy.taxPolicy) {
    unresolved.push({ code: "policy_missing", message: "The seller has not said how tax applies yet, so checkout is paused." });
  }
  if (kinds.has("goods")) {
    if (input.deliveryRequested) {
      unresolved.push({
        code: "delivery_not_offered",
        message: `${policy.sellerName} offers pickup only. Choose pickup to continue, or ask the seller about delivery.`,
      });
    } else if (!policy.pickupPolicy) {
      unresolved.push({ code: "policy_missing", message: "The seller has not set pickup terms yet." });
    } else {
      charges.push({ code: "pickup", label: "Pickup", amountMinor: 0 });
    }
  }
  if (kinds.has("service")) {
    if (!policy.serviceRequestPolicy) {
      unresolved.push({ code: "policy_missing", message: "The seller has not set terms for service requests yet." });
    } else {
      charges.push({ code: "service_request", label: "Service request (time confirmed after payment)", amountMinor: 0 });
    }
  }
  if (kinds.has("digital")) {
    if (!policy.digitalAccessPolicy) {
      unresolved.push({ code: "policy_missing", message: "The seller has not set download access terms yet." });
    } else {
      charges.push({ code: "digital_delivery", label: "Download access", amountMinor: 0 });
    }
  }

  const subtotalMinor = lines.some((line) => line.lineTotalMinor === null) ? null : lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0);
  const totalMinor = subtotalMinor === null ? null : subtotalMinor + charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
  if (totalMinor !== null && totalMinor > 100_000_000) throw new PricingRejection("This quote exceeds the supported total. Request fewer items.");
  const currency = input.sellerCurrency;

  if (input.budgetMinor !== null && totalMinor !== null && totalMinor > input.budgetMinor) {
    unresolved.push({
      code: "over_budget",
      message: `This comes to ${formatMoney(totalMinor, currency)}, above your ${formatMoney(input.budgetMinor, currency)} budget. Raise your budget or choose something else.`,
    });
  }

  let status: PricedQuote["status"] = "review_ready";
  let reviewReason: string | null = null;
  if (unresolved.length > 0) {
    status = "needs_information";
  } else if (needsScopeReview) {
    status = "seller_review";
    reviewReason = totalMinor === null ? "The seller will send the price and confirm the work before you decide whether to pay." : "The seller confirms what this service covers before you pay.";
  }
  return { lines, charges, unresolved, subtotalMinor, totalMinor, currency, status, reviewReason };
}
