/**
 * What the buyer agent may read from the catalog, and the offer cards it may
 * show. Small catalogs go to the model whole, so it judges fit from the
 * seller's own words. Larger ones are narrowed by plain word overlap and the
 * model can search again with other words. There is deliberately no synonym
 * table: deciding that a night commuter might like a front light is the model's
 * reasoning, not a list in our code.
 */
import { formatQuoteAmount } from "@/lib/money";
import type { OfferKind } from "@/server/db/types";
import type { PublicOffer } from "@/server/domain/offers";

/** Catalogs up to this size are given to the model in full. */
export const WHOLE_CATALOG_LIMIT = 40;
/** Larger catalogs return at most this many offers per search. */
export const SEARCH_LIMIT = 20;
const DESCRIPTION_LIMIT = 600;

/** One offer as the model reads it: the seller's approved facts and nothing else. */
export type OfferFact = {
  offerId: string;
  title: string;
  kind: OfferKind;
  price: string;
  unitAmountMinor: number | null;
  currency: string;
  stock: string;
  maxPerOrder: number;
  description: string;
  fulfillment: string;
  approvedScope: string | null;
  sellerConfirmsBeforePayment: boolean;
  downloadAccessDays: number | null;
};

export type CatalogLook = {
  totalPublished: number;
  matchingFilters: number;
  narrowedBySearch: boolean;
  offers: OfferFact[];
  note: string | null;
};

/** The card a buyer sees. It is rendered from these server records, never from model prose. */
export type OfferCard = Pick<
  PublicOffer,
  "id" | "kind" | "title" | "unitAmountMinor" | "currency" | "available" | "maxQuantity" | "fulfillmentNote" | "imagePath" | "requiresScopeReview"
> & { summary: string };

export type ShownOffers = { offers: OfferCard[]; unknownIds: string[] };

/** Common English function words; nothing here is specific to any shop. */
const STOP = new Set(
  "a an and any are as at be but by can do for from get had has have i if in into is it its me my no not of on or our so some than that the their them then there these they this to too up us was we what when which who will with would you your".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOP.has(word));
}

/** How many request words appear in the offer, allowing simple word endings (light, lights). */
function overlap(request: string[], offer: string[]): number {
  let score = 0;
  for (const asked of new Set(request)) {
    const hit = offer.some((word) => word === asked || (asked.length >= 4 && word.length >= 4 && (word.startsWith(asked) || asked.startsWith(word))));
    if (hit) score += 1;
  }
  return score;
}

function stockWords(offer: PublicOffer): string {
  if (offer.available === null) return "no stock limit";
  if (offer.available === 0) return "sold out";
  return `${offer.available} available`;
}

function fact(offer: PublicOffer): OfferFact {
  return {
    offerId: offer.id,
    title: offer.title,
    kind: offer.kind,
    price: offer.unitAmountMinor === null ? "Price set by the seller after review; budget fit is unknown." : formatQuoteAmount(offer.unitAmountMinor, offer.currency),
    unitAmountMinor: offer.unitAmountMinor,
    currency: offer.currency,
    stock: stockWords(offer),
    maxPerOrder: offer.maxQuantity,
    description: offer.description.length > DESCRIPTION_LIMIT ? `${offer.description.slice(0, DESCRIPTION_LIMIT - 1)}…` : offer.description,
    fulfillment: offer.fulfillmentNote,
    approvedScope: offer.serviceScope,
    sellerConfirmsBeforePayment: offer.requiresScopeReview,
    downloadAccessDays: offer.accessDays,
  };
}

function summary(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description;
  return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
}

/**
 * The offers the model may consider for a request. Filters are applied first;
 * a small result is returned whole, a large one is narrowed by word overlap.
 */
export function lookAtCatalog(published: PublicOffer[], request: string, maxPriceMinor: number | null, kind: OfferKind | null): CatalogLook {
  const pool = published.filter((offer) => (!kind || offer.kind === kind) && (maxPriceMinor === null || offer.unitAmountMinor === null || offer.unitAmountMinor <= maxPriceMinor));
  if (pool.length <= WHOLE_CATALOG_LIMIT) {
    return { totalPublished: published.length, matchingFilters: pool.length, narrowedBySearch: false, offers: pool.map(fact), note: pool.length === 0 ? "No published offer fits these filters." : null };
  }
  const asked = words(request);
  const ranked = pool
    .map((offer) => ({ offer, score: overlap(asked, words(`${offer.title} ${offer.description} ${offer.fulfillmentNote}`)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.offer.unitAmountMinor ?? Number.MAX_SAFE_INTEGER) - (b.offer.unitAmountMinor ?? Number.MAX_SAFE_INTEGER))
    .slice(0, SEARCH_LIMIT);
  return {
    totalPublished: published.length,
    matchingFilters: pool.length,
    narrowedBySearch: true,
    offers: ranked.map(({ offer }) => fact(offer)),
    note: ranked.length === 0 ? "No offer shares words with that request. Search again with other words the seller might use, or ask the buyer." : null,
  };
}

/** Cards for offers the model chose to show. Unknown or unpublished ids are reported, never shown. */
export function cardsFor(published: PublicOffer[], ids: string[]): ShownOffers {
  const byId = new Map(published.map((offer) => [offer.id, offer]));
  const offers: OfferCard[] = [];
  const unknownIds: string[] = [];
  for (const id of new Set(ids)) {
    const offer = byId.get(id);
    if (!offer) {
      unknownIds.push(id);
      continue;
    }
    offers.push({
      id: offer.id,
      kind: offer.kind,
      title: offer.title,
      unitAmountMinor: offer.unitAmountMinor,
      currency: offer.currency,
      available: offer.available,
      maxQuantity: offer.maxQuantity,
      fulfillmentNote: offer.fulfillmentNote,
      imagePath: offer.imagePath,
      requiresScopeReview: offer.requiresScopeReview,
      summary: summary(offer.description),
    });
  }
  return { offers, unknownIds };
}
