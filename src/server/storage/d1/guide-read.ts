import { GUIDE_LIMIT, publicShopUrl, type GuideSource } from "@/lib/shop-guide";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  offer,
  seller,
  shopGuide,
  shopGuideVersion,
} from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import { ownerScope } from "./guards";

const active = () =>
  and(
    eq(shopGuide.published, true),
    eq(shopGuide.archived, false),
    sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil}>${nowMilliseconds})`,
  );
async function owner(db: D1Db, principal: OwnerPrincipal) {
  if (
    !(
      await db
        .select({ id: seller.id })
        .from(seller)
        .where(and(eq(seller.id, principal.sellerId), ownerScope(principal)))
    )[0]
  )
    throw notFound("shop");
}
async function publicSources(
  db: D1Db,
  buyer: BuyerPrincipal,
  scope: SQL | undefined,
): Promise<{ sources: GuideSource[] }> {
  const rows = await db
    .select()
    .from(shopGuide)
    .where(and(eq(shopGuide.sellerId, buyer.sellerId), active(), scope))
    .orderBy(asc(shopGuide.createdAt))
    .limit(GUIDE_LIMIT);
  return {
    sources: rows.map((row) => ({
      id: row.id,
      revision: row.revision,
      title: row.title,
      topic: row.topic,
      body: row.body,
      updatedAt: row.updatedAt.toISOString(),
      hasNextStep: Boolean(row.actionUrl),
      productId: row.productId,
      validUntil: row.validUntil?.toISOString() ?? null,
    })),
  };
}

/** Native public knowledge projections and revision-checked destination resolution. */
export function createD1GuideReads(db: D1Db) {
  return {
    async listOwnerGuide(principal: OwnerPrincipal, includeArchived = false) {
      await owner(db, principal);
      return db
        .select()
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.sellerId, principal.sellerId),
            includeArchived ? undefined : eq(shopGuide.archived, false),
          ),
        )
        .orderBy(asc(shopGuide.createdAt));
    },
    async readShopGuide(buyer: BuyerPrincipal, productId?: string) {
      if (productId) {
        z.uuid().parse(productId);
        if (
          !(
            await db
              .select({ id: offer.id })
              .from(offer)
              .where(
                and(
                  eq(offer.id, productId),
                  eq(offer.sellerId, buyer.sellerId),
                  eq(offer.published, true),
                ),
              )
          )[0]
        )
          throw notFound("published product");
      }
      return publicSources(
        db,
        buyer,
        productId
          ? or(isNull(shopGuide.productId), eq(shopGuide.productId, productId))
          : isNull(shopGuide.productId),
      );
    },
    async readCatalogGuide(buyer: BuyerPrincipal, ids: string[]) {
      z.array(z.uuid()).max(40).parse(ids);
      const products = db
        .select({ id: offer.id })
        .from(offer)
        .where(
          and(
            eq(offer.sellerId, buyer.sellerId),
            eq(offer.published, true),
            inArray(offer.id, ids),
          ),
        );
      return publicSources(
        db,
        buyer,
        or(isNull(shopGuide.productId), inArray(shopGuide.productId, products)),
      );
    },
    async approvedDestination(sellerId: string, id: string, revision: number) {
      z.uuid().parse(id);
      z.number().int().positive().parse(revision);
      const [row] = await db
        .select()
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.id, id),
            eq(shopGuide.sellerId, sellerId),
            eq(shopGuide.revision, revision),
            active(),
            sql`(${shopGuide.productId} is null or exists(select 1 from offer o where o.id=${shopGuide.productId} and o.seller_id=${sellerId} and o.published=1))`,
          ),
        );
      if (!row?.actionLabel || !row.actionUrl || !publicShopUrl(row.actionUrl))
        throw notFound(
          "current shop link; ask the assistant for the latest step",
        );
      return row;
    },
    async guideHistory(principal: OwnerPrincipal, id: string) {
      z.uuid().parse(id);
      await owner(db, principal);
      if (
        !(
          await db
            .select({ id: shopGuide.id })
            .from(shopGuide)
            .where(
              and(
                eq(shopGuide.id, id),
                eq(shopGuide.sellerId, principal.sellerId),
              ),
            )
        )[0]
      )
        throw notFound("shop knowledge entry");
      return (
        await db
          .select()
          .from(shopGuideVersion)
          .where(
            and(
              eq(shopGuideVersion.guideId, id),
              eq(shopGuideVersion.sellerId, principal.sellerId),
            ),
          )
          .orderBy(desc(shopGuideVersion.revision))
          .limit(100)
      ).map((version) => ({
        revision: version.revision,
        savedAt: version.createdAt.toISOString(),
        snapshot: version.snapshot,
      }));
    },
  };
}
