import type { PublicOffer } from "@/server/domain/offers";

/** Availability in words; null means the offer has no stock limit. */
export function availabilityText(offer: Pick<PublicOffer, "kind" | "available" | "maxQuantity">): { text: string; soldOut: boolean } | null {
  if (offer.kind !== "goods" || offer.available === null) return null;
  if (offer.available === 0) return { text: "Sold out", soldOut: true };
  if (offer.available === 1) return { text: offer.maxQuantity === 1 ? "Only one exists" : "Last one", soldOut: false };
  if (offer.available <= 3) return { text: `${offer.available} left`, soldOut: false };
  return { text: "In stock", soldOut: false };
}

export { QUOTE_STATUS } from "@/lib/quote-status";
