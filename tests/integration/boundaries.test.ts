/**
 * Buyer boundaries and quote integrity: capabilities cannot be forged, reused
 * after ending, or carried to another buyer's records; handoff codes work once;
 * a checkout only accepts the exact, latest, unexpired quote the buyer reviewed.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { buyerHandoff, inventory, offer, quote } from "@/server/db/schema";
import { createHandoff, endBuyerSession, exchangeHandoff, resolveBuyer } from "@/server/domain/buyer-session";
import type { DomainError } from "@/server/domain/errors";
import { saveOffer } from "@/server/domain/offers";
import { checkOrderAccessKey, getBuyerOrder, orderAccessKey } from "@/server/domain/orders";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { cancelQuote, getBuyerQuote, proposeQuote } from "@/server/domain/quotes";
import { getSeller, type SellerRow, updateSellerProfile } from "@/server/domain/seller";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, quoteFor, resetShop, tally } from "../support/shop";

const MUG = "Disc brake pads";
let owner: OwnerPrincipal;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as DomainError).code ?? "error";
  }
}

function profileFrom(row: SellerRow) {
  return {
    expectedPolicyRevision: row.policyRevision,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    country: row.country,
    pickupPolicy: row.pickupPolicy,
    serviceRequestPolicy: row.serviceRequestPolicy,
    digitalAccessPolicy: row.digitalAccessPolicy,
    cancellationPolicy: row.cancellationPolicy,
    taxPolicy: row.taxPolicy,
    allowedOrigins: row.allowedOrigins,
    buyerTurnsPer10Min: row.buyerTurnsPer10Min,
    sellerDailyAiTurns: row.sellerDailyAiTurns,
  };
}

describe("buyer capabilities", () => {
  beforeEach(async () => {
    ({ owner } = await resetShop());
  });

  it("a made-up token is refused", async () => {
    expect(await code(resolveBuyer("A".repeat(43)))).toBe("unauthorized");
    expect(await code(resolveBuyer(""))).toBe("unauthorized");
  });

  it("an ended chat cannot be used again, on any device", async () => {
    const buyer = await newBuyer();
    await endBuyerSession(buyer);
    expect(await code(resolveBuyer(buyer.token))).toBe("unauthorized");
  });

  it("another buyer cannot read or cancel this quote", async () => {
    const buyer = await newBuyer();
    const stranger = await newBuyer();
    const q = await quoteFor(buyer, MUG);
    expect(await code(getBuyerQuote(stranger, q.id))).toBe("not_found");
    expect(await code(cancelQuote(stranger, { quoteId: q.id, revision: q.revision }))).toBe("not_found");
    expect(await code(startCheckout(stranger, { quoteId: q.id, revision: q.revision }))).toBe("not_found");
  });

  it("a handoff code opens checkout once, as the same buyer", async () => {
    const buyer = await newBuyer("widget");
    const q = await quoteFor(buyer, MUG);
    const { code: handoff } = await createHandoff(buyer, q.id);
    const issued = await exchangeHandoff(handoff);
    expect(issued.quoteId).toBe(q.id);
    const topLevel = await resolveBuyer(issued.token);
    expect(topLevel.buyerSessionId).toBe(buyer.buyerSessionId);
    expect((await getBuyerQuote(topLevel, q.id)).id).toBe(q.id);
    expect(await code(exchangeHandoff(handoff))).toBe("unauthorized");
  });

  it("an expired handoff code is refused", async () => {
    const buyer = await newBuyer("widget");
    const { code: handoff } = await createHandoff(buyer, null);
    await getDb().update(buyerHandoff).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(await code(exchangeHandoff(handoff))).toBe("unauthorized");
  });

  it("an order is visible only to its buyer or with a valid, unexpired order link", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    const paid = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    const orderId = paid.order?.id as string;
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).number).toBe(1001);
    const stranger = await newBuyer();
    expect(await code(getBuyerOrder({ buyer: stranger, key: null }, orderId))).toBe("not_found");
    expect(await code(getBuyerOrder({ buyer: null, key: null }, orderId))).toBe("not_found");
    const key = orderAccessKey(orderId);
    expect((await getBuyerOrder({ buyer: null, key }, orderId)).id).toBe(orderId);
    expect(await code(getBuyerOrder({ buyer: null, key: `${key.slice(0, -2)}xx` }, orderId))).toBe("not_found");
    const expired = orderAccessKey(orderId, Date.now() - 31 * 86_400_000);
    expect(checkOrderAccessKey(orderId, expired)).toBe(false);
    expect(await code(getBuyerOrder({ buyer: null, key: expired }, orderId))).toBe("not_found");
  });
});

describe("quote integrity", () => {
  beforeEach(async () => {
    ({ owner } = await resetShop());
  });

  it("a request that carries its own price or total is refused and nothing is saved", async () => {
    const buyer = await newBuyer();
    const id = await offerId(MUG);
    expect(await code(proposeQuote(buyer, { lines: [{ offerId: id, quantity: 1 }], totalMinor: 1 } as never))).toBe("invalid");
    expect(await code(proposeQuote(buyer, { lines: [{ offerId: id, quantity: 1, unitAmountMinor: 1 }] } as never))).toBe("invalid");
    const rows = await getDb().select({ id: quote.id }).from(quote);
    expect(rows).toHaveLength(0);
  });

  it("the server prices every line from the published offer", async () => {
    const buyer = await newBuyer();
    const q = await quoteFor(buyer, MUG, 2);
    const [row] = await getDb().select({ price: offer.unitAmountMinor }).from(offer).where(eq(offer.id, await offerId(MUG)));
    expect(q.lines[0]?.unitAmountMinor).toBe(row?.price);
    expect(q.totalMinor).toBe((row?.price ?? 0) * 2);
  });

  it("only the latest revision of a quote can be paid", async () => {
    const buyer = await newBuyer();
    const first = await quoteFor(buyer, MUG, 1);
    const second = await proposeQuote(buyer, { threadId: first.threadId, lines: [{ offerId: await offerId(MUG), quantity: 2 }] });
    expect(second.revision).toBe(2);
    expect(await code(startCheckout(buyer, { quoteId: first.id, revision: first.revision }))).toBe("conflict");
    const view = await startCheckout(buyer, { quoteId: second.id, revision: second.revision });
    expect(view.state).toBe("order_created");
  });

  it("an expired quote cannot be paid", async () => {
    const buyer = await newBuyer();
    const q = await quoteFor(buyer, MUG);
    await getDb().update(quote).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(quote.id, q.id));
    expect(await code(startCheckout(buyer, { quoteId: q.id, revision: q.revision }))).toBe("expired");
    expect((await tally()).providerOrders).toBe(0);
  });

  it("changed seller terms invalidate quotes made under the old terms", async () => {
    const buyer = await newBuyer();
    const q = await quoteFor(buyer, MUG);
    const seller = (await getSeller()) as SellerRow;
    await updateSellerProfile(owner, { ...profileFrom(seller), cancellationPolicy: "Cancel any time before pickup for a full refund." });
    expect(await code(startCheckout(buyer, { quoteId: q.id, revision: q.revision }))).toBe("conflict");
  });

  it("changing only the shop colours keeps the terms version, so open quotes stay payable", async () => {
    const buyer = await newBuyer();
    const q = await quoteFor(buyer, MUG);
    const before = (await getSeller()) as SellerRow;
    const after = await updateSellerProfile(owner, { ...profileFrom(before), theme: "brick" });
    expect(after.theme).toBe("brick");
    expect(after.policyRevision).toBe(before.policyRevision);
    expect(await code(startCheckout(buyer, { quoteId: q.id, revision: q.revision }))).toBe("resolved");
  });

  it("an unknown palette is refused by the form schema and by the database", async () => {
    const seller = (await getSeller()) as SellerRow;
    expect(await code(updateSellerProfile(owner, { ...profileFrom(seller), theme: "neon" as never }))).not.toBe("resolved");
    expect(await code(getDb().execute(sql`update seller set theme = 'neon'`))).not.toBe("resolved");
    expect(((await getSeller()) as SellerRow).theme).toBe(seller.theme);
  });

  it("a price change after the quote invalidates it before any PayPal order exists", async () => {
    const buyer = await newBuyer();
    const q = await quoteFor(buyer, MUG);
    const [row] = await getDb().select().from(offer).where(eq(offer.id, await offerId(MUG)));
    const [stock] = await getDb().select().from(inventory).where(eq(inventory.offerId, row?.id as string));
    if (!row || !stock) throw new Error("mug missing");
    await saveOffer(owner, (await getSeller()) as SellerRow, {
      id: row.id,
      expectedRevision: row.revision,
      kind: row.kind,
      title: row.title,
      description: row.description,
      unitAmountMinor: row.unitAmountMinor! + 500,
      fulfillmentNote: row.fulfillmentNote,
      requiresScopeReview: row.requiresScopeReview,
      serviceScope: row.serviceScope,
      accessDays: row.accessDays,
      digitalAssetId: row.digitalAssetId,
      maxQuantity: row.maxQuantity,
      stockTotal: stock.total,
    });
    expect(await code(startCheckout(buyer, { quoteId: q.id, revision: q.revision }))).toBe("conflict");
    expect((await tally()).providerOrders).toBe(0);
  });
});
