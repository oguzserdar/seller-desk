import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  digitalAsset,
  inventory,
  offer,
  paymentAttempt,
  reservation,
} from "@/server/db/sqlite/schema";
import { toPublicOffer } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { D1Db } from "./client";

type OfferStock = {
  offer: typeof offer.$inferSelect;
  stock: typeof inventory.$inferSelect | null;
};

/** Expired unapproved holds are displayed as available, but reads never release stock. */
async function liveAvailability(
  db: D1Db,
  rows: OfferStock[],
): Promise<OfferStock[]> {
  if (!rows.length) return rows;
  const expired = await db
    .select({
      offerId: reservation.offerId,
      units: sql<number>`sum(${reservation.quantity})`,
    })
    .from(reservation)
    .innerJoin(paymentAttempt, eq(paymentAttempt.quoteId, reservation.quoteId))
    .where(
      and(
        sql`${reservation.offerId} in (select value from json_each(${JSON.stringify(rows.map((row) => row.offer.id))}))`,
        eq(reservation.state, "held"),
        sql`${reservation.expiresAt}<${nowMilliseconds}`,
        eq(paymentAttempt.state, "order_created"),
      ),
    )
    .groupBy(reservation.offerId);
  const units = new Map(expired.map((row) => [row.offerId, row.units]));
  return rows.map((row) =>
    row.stock
      ? {
          ...row,
          stock: {
            ...row.stock,
            held: row.stock.held - (units.get(row.offer.id) ?? 0),
          },
        }
      : row,
  );
}

/** Native D1 catalog reads retain the existing public and private projections. */
export function createD1CatalogReads(db: D1Db) {
  return {
    async listPublishedOffers(sellerId: string) {
      const rows = await db
        .select({ offer, stock: inventory })
        .from(offer)
        .leftJoin(inventory, eq(inventory.offerId, offer.id))
        .where(and(eq(offer.sellerId, sellerId), eq(offer.published, true)))
        .orderBy(asc(offer.sortOrder), asc(offer.createdAt));
      return (await liveAvailability(db, rows)).map((row) =>
        toPublicOffer(row.offer, row.stock ?? undefined),
      );
    },
    async listOwnerOffers(owner: OwnerPrincipal) {
      const rows = await db
        .select({ offer, stock: inventory, assetName: digitalAsset.filename })
        .from(offer)
        .leftJoin(inventory, eq(inventory.offerId, offer.id))
        .leftJoin(digitalAsset, eq(digitalAsset.id, offer.digitalAssetId))
        .where(eq(offer.sellerId, owner.sellerId))
        .orderBy(asc(offer.sortOrder), asc(offer.createdAt));
      return rows.map(({ offer: row, stock, assetName }) => ({
        row,
        stock: stock ?? undefined,
        assetName,
      }));
    },
    async loadOffersForQuote(sellerId: string, ids: string[]) {
      if (!ids.length) return [];
      const rows = await db
        .select({ offer, stock: inventory })
        .from(offer)
        .leftJoin(inventory, eq(inventory.offerId, offer.id))
        .where(and(eq(offer.sellerId, sellerId), inArray(offer.id, ids)));
      return liveAvailability(db, rows);
    },
  };
}
