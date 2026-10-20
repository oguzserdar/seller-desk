import { PROCEDURE_LIMIT } from "@/lib/assistant-procedure";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  assistantProcedure,
  assistantProcedureVersion,
  inventory,
  offer,
  seller,
  shopGuide,
} from "@/server/db/sqlite/schema";
import { invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import type { SimulationShopSnapshot } from "@/server/simulation/snapshot";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { D1Db } from "./client";

/** Coherent native read batch containing only public shop facts. No credentials, customer history or file bytes. */
export async function captureD1SimulationShop(
  db: D1Db,
  owner: OwnerPrincipal,
): Promise<SimulationShopSnapshot> {
  const [shops, products, guides, procedures, clock] = await db.batch([
    db
      .select({
        displayName: seller.displayName,
        country: seller.country,
        currency: seller.currency,
        policyRevision: seller.policyRevision,
        pickupPolicy: seller.pickupPolicy,
        serviceRequestPolicy: seller.serviceRequestPolicy,
        digitalAccessPolicy: seller.digitalAccessPolicy,
        cancellationPolicy: seller.cancellationPolicy,
        taxPolicy: seller.taxPolicy,
        quoteTtlMinutes: seller.quoteTtlMinutes,
        holdTtlMinutes: seller.holdTtlMinutes,
        buyerTurnsPer10Min: seller.buyerTurnsPer10Min,
        sellerDailyAiTurns: seller.sellerDailyAiTurns,
      })
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      ),
    db
      .select({
        sourceId: offer.id,
        revision: offer.revision,
        kind: offer.kind,
        title: offer.title,
        description: offer.description,
        unitAmountMinor: offer.unitAmountMinor,
        currency: offer.currency,
        fulfillmentNote: offer.fulfillmentNote,
        requiresScopeReview: offer.requiresScopeReview,
        serviceScope: offer.serviceScope,
        accessDays: offer.accessDays,
        maxQuantity: offer.maxQuantity,
        sortOrder: offer.sortOrder,
        imagePath: offer.imagePath,
        available: sql<
          number | null
        >`${inventory.total}-${inventory.held}-${inventory.sold}`,
      })
      .from(offer)
      .leftJoin(inventory, eq(inventory.offerId, offer.id))
      .where(and(eq(offer.sellerId, owner.sellerId), eq(offer.published, true)))
      .orderBy(asc(offer.id))
      .limit(41),
    db
      .select({
        sourceId: shopGuide.id,
        revision: shopGuide.revision,
        title: shopGuide.title,
        topic: shopGuide.topic,
        body: shopGuide.body,
        productId: shopGuide.productId,
        validUntil: shopGuide.validUntil,
      })
      .from(shopGuide)
      .where(
        and(
          eq(shopGuide.sellerId, owner.sellerId),
          eq(shopGuide.published, true),
          eq(shopGuide.archived, false),
          sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil}>${nowMilliseconds})`,
        ),
      )
      .orderBy(asc(shopGuide.id)),
    db
      .select({
        sourceId: assistantProcedure.id,
        revision: assistantProcedureVersion.revision,
        content: assistantProcedureVersion.content,
      })
      .from(assistantProcedure)
      .innerJoin(
        assistantProcedureVersion,
        and(
          eq(assistantProcedureVersion.procedureId, assistantProcedure.id),
          eq(assistantProcedureVersion.sellerId, assistantProcedure.sellerId),
          eq(
            assistantProcedureVersion.revision,
            assistantProcedure.publishedRevision,
          ),
        ),
      )
      .where(
        and(
          eq(assistantProcedure.sellerId, owner.sellerId),
          eq(assistantProcedure.archived, false),
          isNotNull(assistantProcedure.publishedRevision),
        ),
      )
      .orderBy(asc(assistantProcedure.createdAt), asc(assistantProcedure.id))
      .limit(PROCEDURE_LIMIT + 1),
    db
      .select({ at: sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ','now')` })
      .from(sql`(select 1)`),
  ]);
  const shop = shops[0];
  if (!shop) throw notFound("shop");
  if (products.length > 40)
    throw invalid("Simulations currently support up to 40 published offers.");
  if (products.some((p) => p.kind === "goods" && p.available === null))
    throw invalid(
      "A published goods offer has no stock record. Fix it before simulating.",
    );
  if (procedures.length > PROCEDURE_LIMIT)
    throw invalid("Too many published handling instructions to simulate.");
  return {
    capturedAt: clock[0]!.at,
    shop,
    products,
    guides: guides
      .filter(
        (g) => !g.productId || products.some((p) => p.sourceId === g.productId),
      )
      .map((g) => ({ ...g, validUntil: g.validUntil?.toISOString() ?? null })),
    procedures,
    limitations: [
      "Payments are fictional.",
      "Digital downloads use a labeled test file; no purchased files are copied.",
      "External shop connections and knowledge action links are disabled.",
      "Customer histories and private seller exceptions are not copied.",
    ],
  };
}
