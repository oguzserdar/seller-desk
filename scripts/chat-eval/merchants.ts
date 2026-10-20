/** Distinct fictional catalogs for real-model checks; never modifies the running shop. */
import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { getDb } from "../../src/server/db/client";
import { offer } from "../../src/server/db/schema";
import { storeAsset } from "../../src/server/domain/digital";
import { saveOffer, setOfferPublished, type OfferInput } from "../../src/server/domain/offers";
import type { OwnerPrincipal } from "../../src/server/domain/principal";
import { getSeller, updateSellerProfile } from "../../src/server/domain/seller";

/** Evaluation-only merchant variants with no shared showcase merchandise. */
export type EvalMerchant = "stationery" | "alterations" | "patterns";

/** Replaces the disposable fixture's published catalog through normal seller operations. */
export async function prepareMerchant(owner: OwnerPrincipal, merchant: EvalMerchant) {
  const current = await getSeller();
  if (!current) throw new Error("Missing fixture seller");
  const existing = await getDb().select().from(offer).where(eq(offer.sellerId, owner.sellerId));
  for (const row of existing) await setOfferPublished(owner, current, { offerId: row.id, expectedRevision: row.revision, published: false });
  const stationery = merchant === "stationery";
  const alterations = merchant === "alterations";
  const shop = await updateSellerProfile(owner, {
    expectedPolicyRevision: current.policyRevision,
    displayName: stationery ? "Paper Harbor" : alterations ? "Mend & Hem" : "Pattern House",
    contactEmail: "hello@example.test", country: "CA", allowedOrigins: [],
    buyerTurnsPer10Min: 20, sellerDailyAiTurns: 100,
    pickupPolicy: stationery ? "Pickup at 18 Paper Lane, Wednesday to Friday 12:00–16:00. No shipping or personalization." : null,
    serviceRequestPolicy: alterations ? "Payment creates a request. The tailor must confirm a fitting time. No same-day or wedding-date guarantee. Custom work needs a written seller quote." : null,
    digitalAccessPolicy: !stationery && !alterations ? "Download access lasts 14 days. You may sell finished sewn bags. You may not resell or share the pattern files. Includes English instructions and SVG pattern pieces, not a physical bag." : null,
    cancellationPolicy: stationery ? "Contact the shop before pickup to cancel." : alterations ? "Contact the tailor before work begins to cancel." : "Contact the designer about broken files. No automatic refunds after download.",
    taxPolicy: "Listed prices include tax.",
  });
  const base: OfferInput = {
    kind: "goods", title: "Harbor notebook", description: "A5 lined notebook, 80 pages, blue cover. No custom lettering.",
    unitAmountMinor: 1200, fulfillmentNote: "Pickup only at 18 Paper Lane.", requiresScopeReview: false,
    serviceScope: null, accessDays: null, digitalAssetId: null, maxQuantity: 3, stockTotal: 3,
  };
  let items: OfferInput[];
  if (stationery) items = [base, { ...base, title: "Harbor art print", description: "Unframed A4 coastal print.", unitAmountMinor: 2200, maxQuantity: 2, stockTotal: 2 }];
  else if (alterations) items = [
    { ...base, kind: "service", title: "Trouser hem", description: "Shorten one pair of plain trousers. Fitting time is confirmed separately.", unitAmountMinor: 2900, fulfillmentNote: "Tailor confirms the fitting after your request.", serviceScope: "Shorten plain trousers; excludes lined, leather and beaded garments.", requiresScopeReview: true, maxQuantity: 1, stockTotal: null },
    { ...base, kind: "service", title: "Custom garment alteration", description: "Seller prices custom work after reviewing the garment and deadline.", unitAmountMinor: null, fulfillmentNote: "Written seller quote required.", serviceScope: "Scope and price depend on seller assessment.", requiresScopeReview: true, maxQuantity: 1, stockTotal: null },
  ];
  else {
    const bytes = Buffer.from(zipSync({ "README.txt": new TextEncoder().encode("Original fictional evaluation file. Pattern House demo asset; not a real sewing pattern.") }));
    const asset = await storeAsset(owner, { filename: "pattern-house-evaluation.zip", bytes });
    items = [{ ...base, kind: "digital", title: "Everyday tote pattern", description: "Digital SVG pattern pieces with English instructions. No finished bag is shipped.", unitAmountMinor: 1800, fulfillmentNote: "Download after confirmed payment; access lasts 14 days.", maxQuantity: 1, stockTotal: null, accessDays: 14, digitalAssetId: asset.id }];
  }
  for (const item of items) {
    const saved = await saveOffer(owner, shop, item);
    await setOfferPublished(owner, shop, { offerId: saved.id, expectedRevision: saved.revision, published: true });
  }
  return shop;
}
