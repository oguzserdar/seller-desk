import {
  auditEvent,
  digitalAsset,
  inventory,
  offer,
  seller,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import {
  OfferInput,
  publishBlockers,
  type OfferRow,
} from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import type { SellerRow } from "@/server/domain/seller";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

async function currentShop(
  db: D1Db,
  owner: OwnerPrincipal,
): Promise<SellerRow> {
  const [shop] = await db
    .select()
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  if (!shop) throw notFound("shop");
  return shop;
}

function shopTerms(owner: OwnerPrincipal, shop: SellerRow) {
  return sql`${ownerScope(owner)} and exists(select 1 from seller where id=${shop.id} and policy_revision=${shop.policyRevision} and currency=${shop.currency})`;
}

/** Native D1 catalog mutations commit the offer, stock and audit together. */
export function createD1CatalogWrites(db: D1Db) {
  return {
    async saveOffer(
      owner: OwnerPrincipal,
      sellerRow: SellerRow,
      raw: OfferInput,
    ): Promise<OfferRow> {
      if (sellerRow.id !== owner.sellerId) throw notFound("shop");
      const input = OfferInput.parse(raw);
      const shop = await currentShop(db, owner);
      if (input.kind === "goods" && input.stockTotal === null)
        throw invalid("Set how many are in stock.");
      const id = input.id ?? crypto.randomUUID();
      const [current] = input.id
        ? await db
            .select()
            .from(offer)
            .where(and(eq(offer.id, id), eq(offer.sellerId, owner.sellerId)))
        : [];
      if (input.id && !current) throw notFound("offer");
      if (current && current.revision !== input.expectedRevision)
        throw conflict(
          "This offer changed in another tab. Reload to see the latest version.",
        );
      if (current && current.kind !== input.kind && current.published)
        throw invalid("Unpublish the offer before changing its type.");
      const [stock] = await db
        .select()
        .from(inventory)
        .where(eq(inventory.offerId, id));
      if (
        input.kind === "goods" &&
        input.stockTotal !== null &&
        stock &&
        input.stockTotal < stock.held + stock.sold
      )
        throw invalid(
          `Stock cannot go below ${stock.held + stock.sold}: ${stock.sold} sold and ${stock.held} held for checkouts in progress.`,
        );
      if (input.digitalAssetId) {
        const [asset] = await db
          .select({ id: digitalAsset.id })
          .from(digitalAsset)
          .where(
            and(
              eq(digitalAsset.id, input.digitalAssetId),
              eq(digitalAsset.sellerId, owner.sellerId),
            ),
          );
        if (!asset) throw notFound("file");
      }
      const values = {
        kind: input.kind,
        title: input.title,
        description: input.description,
        unitAmountMinor: input.unitAmountMinor,
        currency: shop.currency,
        fulfillmentNote: input.fulfillmentNote,
        requiresScopeReview:
          input.kind === "service" ? input.requiresScopeReview : false,
        serviceScope: input.kind === "service" ? input.serviceScope : null,
        accessDays: input.kind === "digital" ? input.accessDays : null,
        digitalAssetId: input.kind === "digital" ? input.digitalAssetId : null,
        maxQuantity:
          input.kind === "goods"
            ? input.maxQuantity
            : input.kind === "digital"
              ? 1
              : Math.min(input.maxQuantity, 5),
        ...(input.imagePath !== undefined
          ? { imagePath: input.imagePath }
          : {}),
        revision: (current?.revision ?? 0) + 1,
      };
      if (current?.published) {
        const blockers = publishBlockers(
          shop,
          { ...current, ...values },
          input.kind === "goods"
            ? {
                offerId: id,
                total: input.stockTotal!,
                held: stock?.held ?? 0,
                sold: stock?.sold ?? 0,
                updatedAt: new Date(),
              }
            : stock,
        );
        if (blockers.length)
          throw invalid(
            `This change would leave a published offer incomplete: ${blockers.join(" ")}`,
          );
      }
      const execution = crypto.randomUUID();
      const guard = sql`${shopTerms(owner, shop)}
        and ${current ? sql`exists(select 1 from offer where id=${id} and seller_id=${owner.sellerId} and revision=${current.revision} and published=${Number(current.published)} and kind=${current.kind})` : sql`not exists(select 1 from offer where id=${id})`}
        and ${input.digitalAssetId ? sql`exists(select 1 from digital_asset where id=${input.digitalAssetId} and seller_id=${owner.sellerId})` : sql`1`}
        and ${input.kind === "goods" ? sql`not exists(select 1 from inventory where offer_id=${id} and held+sold>${input.stockTotal})` : sql`1`}`;
      try {
        const results = await db.batch([
          batchGuard(db, `${execution}:catalog`, guard),
          current
            ? db.update(offer).set(values).where(eq(offer.id, id))
            : db
                .insert(offer)
                .values({
                  ...values,
                  id,
                  sellerId: owner.sellerId,
                  published: false,
                }),
          ...(input.kind === "goods"
            ? [
                db
                  .insert(inventory)
                  .values({ offerId: id, total: input.stockTotal! })
                  .onConflictDoUpdate({
                    target: inventory.offerId,
                    set: { total: input.stockTotal! },
                  }),
              ]
            : []),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: current ? "offer.update" : "offer.create",
              targetType: "offer",
              targetId: id,
              outcome: "ok",
              details: { revision: values.revision, kind: values.kind },
            }),
          db.select().from(offer).where(eq(offer.id, id)),
          clearBatchGuards(db, execution),
        ]);
        return (results[results.length - 2] as OfferRow[])[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This offer or stock changed in another tab. Reload to see the latest version.",
          );
        throw error;
      }
    },
    async setOfferPublished(
      owner: OwnerPrincipal,
      sellerRow: SellerRow,
      input: { offerId: string; expectedRevision: number; published: boolean },
    ): Promise<OfferRow> {
      if (sellerRow.id !== owner.sellerId) throw notFound("shop");
      const shop = await currentShop(db, owner);
      const [current] = await db
        .select()
        .from(offer)
        .where(
          and(eq(offer.id, input.offerId), eq(offer.sellerId, owner.sellerId)),
        );
      if (!current) throw notFound("offer");
      if (current.revision !== input.expectedRevision)
        throw conflict(
          "This offer changed after you reviewed it. Reload and review it again.",
        );
      const [stock] = await db
        .select()
        .from(inventory)
        .where(eq(inventory.offerId, current.id));
      if (input.published) {
        const blockers = publishBlockers(shop, current, stock);
        if (blockers.length) throw invalid(blockers.join(" "));
      }
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:publication`,
            sql`${shopTerms(owner, shop)} and exists(select 1 from offer where id=${current.id} and seller_id=${owner.sellerId} and revision=${current.revision}) and ${current.kind === "goods" && input.published ? sql`exists(select 1 from inventory where offer_id=${current.id})` : sql`1`}`,
          ),
          db
            .update(offer)
            .set({ published: input.published })
            .where(eq(offer.id, current.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: input.published ? "offer.publish" : "offer.unpublish",
              targetType: "offer",
              targetId: current.id,
              outcome: "ok",
              details: { revision: current.revision },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This offer changed after you reviewed it. Reload and review it again.",
          );
        throw error;
      }
    },
  };
}
