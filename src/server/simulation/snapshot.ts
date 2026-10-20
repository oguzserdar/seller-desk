/** Allowlisted shop facts for a private simulation. Never a database or customer clone. */
import { PROCEDURE_LIMIT } from "@/lib/assistant-procedure";
import { getDb, STATEMENT_TIMEOUT_MS } from "@/server/db/client";
import {
  assistantProcedure,
  assistantProcedureVersion,
  inventory,
  offer,
  seller,
  shopGuide,
} from "@/server/db/schema";
import { invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getStorage } from "@/server/storage";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

/**
 * Reads a consistent published shop, with version references for later comparisons.
 * Authentication must establish owner before calling; ownership is proved again here.
 * Private answers, draft knowledge, credentials, payments and purchased bytes are absent.
 * This internal snapshot must never be accepted from browser or model input.
 */
async function capturePostgresSimulationShop(owner: OwnerPrincipal) {
  return getDb().transaction(
    async (tx) => {
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
      );
      const [shop] = await tx
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
        );
      if (!shop) throw notFound("shop");
      const products = await tx
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
          >`${inventory.total} - ${inventory.held} - ${inventory.sold}`,
        })
        .from(offer)
        .leftJoin(inventory, eq(inventory.offerId, offer.id))
        .where(
          and(eq(offer.sellerId, owner.sellerId), eq(offer.published, true)),
        )
        .orderBy(asc(offer.id))
        .limit(41);
      if (products.length > 40)
        throw invalid(
          "Simulations currently support up to 40 published offers.",
        );
      if (products.some((p) => p.kind === "goods" && p.available === null))
        throw invalid(
          "A published goods offer has no stock record. Fix it before simulating.",
        );
      const guides = await tx
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
            sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil} > now())`,
          ),
        )
        .orderBy(asc(shopGuide.id));
      const procedures = await tx
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
        .limit(PROCEDURE_LIMIT + 1);
      if (procedures.length > PROCEDURE_LIMIT)
        throw invalid("Too many published handling instructions to simulate.");
      const time = await tx.execute<{ at: string }>(
        sql`select transaction_timestamp()::text as at`,
      );
      return {
        capturedAt: new Date(time.rows[0]!.at).toISOString(),
        shop,
        products,
        guides: guides
          .filter(
            (g) =>
              !g.productId || products.some((p) => p.sourceId === g.productId),
          )
          .map((g) => ({
            ...g,
            validUntil: g.validUntil?.toISOString() ?? null,
          })),
        procedures,
        limitations: [
          "Payments are fictional.",
          "Digital downloads use a labeled test file; no purchased files are copied.",
          "External shop connections and knowledge action links are disabled.",
          "Customer histories and private seller exceptions are not copied.",
        ],
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Server-owned, JSON-serializable source facts. No credentials or customer identifiers. */
export type SimulationShopSnapshot = Awaited<
  ReturnType<typeof capturePostgresSimulationShop>
>;

/** Captures only allowlisted public facts through the selected native database. */
export async function captureSimulationShop(
  owner: OwnerPrincipal,
): Promise<SimulationShopSnapshot> {
  const backend = getStorage();
  return backend.kind === "d1"
    ? backend.simulation.captureShop(owner)
    : capturePostgresSimulationShop(owner);
}
