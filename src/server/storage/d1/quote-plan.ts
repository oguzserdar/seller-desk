import { digitalQuoteLine, quote } from "@/server/db/sqlite/schema";
import { invalid } from "@/server/domain/errors";
import { priceQuote, PricingRejection } from "@/server/domain/pricing";
import type { QuoteRequest } from "@/server/domain/quotes";
import { policySnapshotOf, type SellerRow } from "@/server/domain/seller";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { createD1CatalogReads } from "./catalog-read";
import type { D1Db } from "./client";

type OfferRows = Awaited<
  ReturnType<ReturnType<typeof createD1CatalogReads>["loadOffersForQuote"]>
>;
/** Pure quote inputs frozen before native batch guards recheck their versions. */
export type D1QuotePlanInput = {
  shop: SellerRow;
  rows: OfferRows;
  buyerSessionId: string;
  threadId: string;
  revision: number;
  request: z.output<typeof QuoteRequest>;
  scopeApproved: boolean;
  approvedScope: string | null;
  sellerPrices?: ReadonlyMap<string, number>;
  retainedExpiry?: Date;
};

/** Prices with the existing shared rulebook and builds native writes without executing them. */
export function d1QuotePlan(db: D1Db, args: D1QuotePlanInput) {
  const offers = new Map(
    args.rows.map(({ offer, stock }) => [
      offer.id,
      { offer, stock: stock ?? undefined },
    ]),
  );
  let priced;
  try {
    priced = priceQuote({
      sellerCurrency: args.shop.currency,
      policy: policySnapshotOf(args.shop),
      lines: args.request.lines,
      offers,
      budgetMinor: args.request.budgetMinor ?? null,
      deliveryRequested: args.request.deliveryRequested ?? false,
      buyerNote: args.request.buyerNote,
      scopeApproved: args.scopeApproved,
      sellerPrices: args.sellerPrices,
    });
  } catch (error) {
    if (error instanceof PricingRejection) throw invalid(error.message);
    throw error;
  }
  const row = {
    id: crypto.randomUUID(),
    threadId: args.threadId,
    revision: args.revision,
    sellerId: args.shop.id,
    buyerSessionId: args.buyerSessionId,
    status: priced.status,
    lines: priced.lines,
    charges: priced.charges,
    unresolved: priced.unresolved,
    policySnapshot: policySnapshotOf(args.shop),
    subtotalMinor: priced.subtotalMinor,
    totalMinor: priced.totalMinor,
    currency: priced.currency,
    buyerNote: args.request.buyerNote ?? null,
    budgetMinor: args.request.budgetMinor ?? null,
    deliveryRequested: args.request.deliveryRequested ?? false,
    reviewReason: priced.reviewReason,
    approvedScope: args.approvedScope,
    sellerApprovedAt: args.scopeApproved ? new Date() : null,
    expiresAt:
      args.retainedExpiry ??
      new Date(Date.now() + args.shop.quoteTtlMinutes * 60000),
  } satisfies typeof quote.$inferInsert;
  const digital = priced.lines
    .filter((line) => line.kind === "digital")
    .map((line) => {
      const offer = offers.get(line.offerId)?.offer;
      if (!offer?.digitalAssetId || !offer.accessDays)
        throw invalid("This download is not ready. Contact the seller.");
      return {
        quoteId: row.id,
        offerId: line.offerId,
        assetId: offer.digitalAssetId,
        accessDays: offer.accessDays,
      };
    });
  const facts = args.rows.map(({ offer }) => ({
    id: offer.id,
    revision: offer.revision,
    published: Number(offer.published),
    amount: offer.unitAmountMinor,
  }));
  const valid = sql`exists(select 1 from seller where id=${args.shop.id} and policy_revision=${args.shop.policyRevision} and currency=${args.shop.currency} and quote_ttl_minutes=${args.shop.quoteTtlMinutes})
    and not exists(select 1 from json_each(${JSON.stringify(facts)}) expected left join offer o on o.id=json_extract(expected.value,'$.id') and o.seller_id=${args.shop.id}
      where o.id is null or o.revision<>json_extract(expected.value,'$.revision') or o.published<>json_extract(expected.value,'$.published') or o.unit_amount_minor is not json_extract(expected.value,'$.amount'))`;
  return {
    row,
    valid,
    writes: [
      db.insert(quote).values(row),
      ...(digital.length ? [db.insert(digitalQuoteLine).values(digital)] : []),
    ],
  };
}
