import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { parsePriceInput } from "@/lib/money";
import { lookAtCatalog } from "@/server/ai/catalog-search";
import { buyerTools } from "@/server/ai/buyer-tools";
import { getDb } from "@/server/db/client";
import { offer, orders, quote } from "@/server/db/schema";
import { listPublishedOffers, OfferInput, saveOffer, setOfferPublished } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { approveQuoteScope, getBuyerQuote, proposeQuote, QuoteRequest } from "@/server/domain/quotes";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { approveAtPayPal, newBuyer, offerId, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const customInput = {
  kind: "service" as const, title: "Repair after inspection", description: "Describe the damage for a written repair quote.",
  unitAmountMinor: null, fulfillmentNote: "Work starts after approval and payment.", requiresScopeReview: true,
  serviceScope: "Seller confirms repair scope and price before payment.", accessDays: null,
  digitalAssetId: null, maxQuantity: 5, stockTotal: null,
};

async function requestCustom(quantity = 1, budgetMinor: number | null = null) {
  const shop = await getSeller();
  if (!shop) throw new Error("No shop");
  const saved = await saveOffer(owner, shop, customInput);
  await setOfferPublished(owner, shop, { offerId: saved.id, expectedRevision: saved.revision, published: true });
  const buyer = await newBuyer();
  const asked = await proposeQuote(buyer, { lines: [{ offerId: saved.id, quantity }], buyerNote: "Two damaged chair legs; keep the original finish.", budgetMinor });
  return { buyer, asked, offerId: saved.id };
}

describe("seller-priced service quotes", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });

  it("allows an unpriced service only when seller review is required", () => {
    expect(OfferInput.safeParse(customInput).success).toBe(true);
    expect(OfferInput.safeParse({ ...customInput, requiresScopeReview: false }).success).toBe(false);
    expect(OfferInput.safeParse({ ...customInput, kind: "goods" }).success).toBe(false);
    expect(OfferInput.safeParse({ ...customInput, kind: "digital" }).success).toBe(false);
  });

  it("keeps an unknown amount null and cannot start payment", async () => {
    const { buyer, asked } = await requestCustom();
    expect(asked).toMatchObject({ status: "seller_review", totalMinor: null, subtotalMinor: null, payment: null });
    expect(asked.lines[0]).toMatchObject({ unitAmountMinor: null, lineTotalMinor: null });
    await expect(startCheckout(buyer, { quoteId: asked.id, revision: asked.revision })).rejects.toMatchObject({ code: "conflict" });
    expect(await tally()).toMatchObject({ attempts: 0, orders: 0 });
    await expect(getDb().update(quote).set({ status: "review_ready" }).where(eq(quote.id, asked.id))).rejects.toThrow();
  });

  it("charges only the new seller-approved revision and keeps its exact scope and amount", async () => {
    const { buyer, asked, offerId } = await requestCustom(2);
    const approved = await approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: 1, approvedScope: "Repair both chair legs, retain original finish.", prices: [{ offerId, unitAmountMinor: 8750 }] });
    expect(approved).toMatchObject({ revision: 2, status: "review_ready", totalMinor: 17500 });
    const shop = await getSeller();
    if (!shop) throw new Error("No shop");
    const options = { toolCallId: "review-check", messages: [], context: {} };
    expect(await buyerTools(buyer, shop).check_seller_answer.execute!({}, options)).toMatchObject({ state: "none", quoteReview: { totalMinor: 17500, approvedScope: approved.approvedScope } });
    expect(await buyerTools(await newBuyer(), shop).check_seller_answer.execute!({}, options)).toMatchObject({ quoteReview: null });
    expect((await getBuyerQuote(buyer, asked.id)).status).toBe("replaced");
    expect(await tally()).toMatchObject({ attempts: 0, orders: 0 });
    await expect(startCheckout(buyer, { quoteId: asked.id, revision: 1 })).rejects.toMatchObject({ code: "conflict" });
    const payment = await startCheckout(buyer, { quoteId: approved.id, revision: 2 });
    await approveAtPayPal(payment);
    const paid = await reconcilePayment(buyer, payment.attemptId, { mayCapture: true });
    expect(paid.state).toBe("paid");
    const [order] = await getDb().select().from(orders);
    expect(order?.snapshot).toMatchObject({ totalMinor: 17500, approvedScope: approved.approvedScope, lines: [{ unitAmountMinor: 8750, lineTotalMinor: 17500 }] });
    expect(await tally()).toMatchObject({ captures: 1, orders: 1 });
  });

  it("rejects missing, duplicate, foreign, zero and excessive prices without replacing the request", async () => {
    const { asked, offerId } = await requestCustom();
    const base = { quoteId: asked.id, expectedRevision: 1, approvedScope: "Repair the two chair legs." };
    for (const prices of [[], [{ offerId, unitAmountMinor: 0 }], [{ offerId, unitAmountMinor: 10_000_001 }], [{ offerId: crypto.randomUUID(), unitAmountMinor: 2500 }], [{ offerId, unitAmountMinor: 2500 }, { offerId, unitAmountMinor: 3000 }]]) {
      await expect(approveQuoteScope(owner, { ...base, prices })).rejects.toThrow();
    }
    expect((await getDb().select().from(quote))).toHaveLength(1);
    await expect(approveQuoteScope({ ...owner, sellerId: crypto.randomUUID() }, { ...base, prices: [{ offerId, unitAmountMinor: 2500 }] })).rejects.toMatchObject({ code: "not_found" });
  });

  it("never accepts buyer-supplied prices and requires another review after a changed request", async () => {
    const { buyer, asked, offerId } = await requestCustom();
    expect(QuoteRequest.safeParse({ lines: [{ offerId, quantity: 1, unitAmountMinor: 1 }] }).success).toBe(false);
    const approved = await approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: 1, approvedScope: "Repair the two chair legs.", prices: [{ offerId, unitAmountMinor: 2500 }] });
    const changed = await proposeQuote(buyer, { threadId: approved.threadId, lines: [{ offerId, quantity: 2 }], buyerNote: "Also replace the back." });
    expect(changed).toMatchObject({ status: "seller_review", totalMinor: null, approvedScope: null });
    await expect(startCheckout(buyer, { quoteId: approved.id, revision: approved.revision })).rejects.toMatchObject({ code: "conflict" });
  });

  it("enforces the buyer budget after pricing and refuses stale catalog approval", async () => {
    const { asked, offerId } = await requestCustom(1, 2000);
    const approved = await approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: 1, approvedScope: "Repair the two chair legs.", prices: [{ offerId, unitAmountMinor: 2500 }] });
    expect(approved).toMatchObject({ status: "needs_information", totalMinor: 2500 });
    expect(approved.unresolved.map((v) => v.code)).toContain("over_budget");
    const other = await requestCustom();
    await getDb().update(offer).set({ revision: 3 }).where(eq(offer.id, other.offerId));
    await expect(approveQuoteScope(owner, { quoteId: other.asked.id, expectedRevision: 1, approvedScope: "Repair legs.", prices: [{ offerId: other.offerId, unitAmountMinor: 2500 }] })).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps fixed catalog prices in mixed quotes and accepts at most one competing approval", async () => {
    const { buyer, asked, offerId: serviceId } = await requestCustom();
    const mugId = await offerId("Disc brake pads");
    const mixed = await proposeQuote(buyer, { threadId: asked.threadId, buyerNote: asked.buyerNote!, lines: [{ offerId: serviceId, quantity: 1 }, { offerId: mugId, quantity: 1 }] });
    const base = { quoteId: mixed.id, expectedRevision: mixed.revision, approvedScope: "Repair legs and include one mug." };
    await expect(approveQuoteScope(owner, { ...base, prices: [{ offerId: serviceId, unitAmountMinor: 2500 }, { offerId: mugId, unitAmountMinor: 1 }] })).rejects.toThrow();
    const attempts = await Promise.allSettled([2500, 3000].map((unitAmountMinor) => approveQuoteScope(owner, { ...base, prices: [{ offerId: serviceId, unitAmountMinor }] })));
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
    const [mug] = await getDb().select().from(offer).where(eq(offer.id, mugId));
    const result = attempts.find((r) => r.status === "fulfilled");
    if (result?.status !== "fulfilled") throw new Error("No approval");
    expect(result.value.lines.find((line) => line.offerId === mugId)?.unitAmountMinor).toBe(mug?.unitAmountMinor);
  });

  it("asks for the work details before sending an unpriced request to the seller", async () => {
    const { buyer, asked, offerId } = await requestCustom();
    const empty = await proposeQuote(buyer, { threadId: asked.threadId, lines: [{ offerId, quantity: 1 }] });
    expect(empty).toMatchObject({ status: "needs_information", totalMinor: null });
    expect(empty.unresolved.map((item) => item.code)).toContain("details_needed");
  });

  it("keeps the seller's price when only the buyer budget changes, until that quote expires", async () => {
    const { buyer, asked, offerId } = await requestCustom(1, 2000);
    const approved = await approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: 1, approvedScope: "Repair legs.", prices: [{ offerId, unitAmountMinor: 2500 }] });
    const ready = await proposeQuote(buyer, { threadId: approved.threadId, buyerNote: asked.buyerNote!, lines: [{ offerId, quantity: 1 }], budgetMinor: 2500 });
    expect(ready).toMatchObject({ status: "review_ready", totalMinor: 2500, approvedScope: "Repair legs." });
    expect(ready.expiresAt).toBe(approved.expiresAt.toISOString());
    await getDb().update(quote).set({ expiresAt: new Date(0) }).where(eq(quote.id, ready.id));
    const expired = await proposeQuote(buyer, { threadId: approved.threadId, buyerNote: asked.buyerNote!, lines: [{ offerId, quantity: 1 }], budgetMinor: 3000 });
    expect(expired).toMatchObject({ status: "seller_review", totalMinor: null });
  });

  it("shows custom services in budget searches without claiming they fit the budget", async () => {
    const { offerId } = await requestCustom();
    const result = lookAtCatalog(await listPublishedOffers(owner.sellerId), "repair", 100, "service");
    const found = result.offers.find((item) => item.offerId === offerId);
    expect(found).toMatchObject({ unitAmountMinor: null });
    expect(found?.price).toContain("budget fit is unknown");
  });
});

it("does not turn malformed or negative seller prices into positive amounts", () => {
  for (const value of ["-10", "-$10", "words10", "1,2", "$-10", "NaN", "10.001"]) expect(parsePriceInput(value, "USD")).toBeNull();
  expect(parsePriceInput("$1,095.50", "USD")).toBe(109550);
  expect(parsePriceInput("95.5", "USD")).toBe(9550);
});
