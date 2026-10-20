import {
  getDb,
  transaction,
  type Queryable,
  type Tx,
} from "@/server/db/client";
import {
  digitalAsset,
  inventory,
  offer,
  OFFER_KINDS,
  paymentAttempt,
  reservation,
  seller,
} from "@/server/db/schema";
import type { OfferKind } from "@/server/db/types";
import { getStorage } from "@/server/storage";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";
import type { SellerRow } from "./seller";

export type OfferRow = typeof offer.$inferSelect;
export type InventoryRow = typeof inventory.$inferSelect;

/** What a buyer may see about a published offer. */
export type PublicOffer = {
  id: string;
  revision: number;
  kind: OfferKind;
  title: string;
  description: string;
  unitAmountMinor: number | null;
  currency: string;
  fulfillmentNote: string;
  requiresScopeReview: boolean;
  serviceScope: string | null;
  accessDays: number | null;
  maxQuantity: number;
  available: number | null;
  imagePath: string | null;
};

export function availableUnits(
  row: Pick<InventoryRow, "total" | "held" | "sold"> | undefined,
): number | null {
  return row ? Math.max(0, row.total - row.held - row.sold) : null;
}

/**
 * Units still held by checkouts that expired before PayPal reported an
 * approval. Buyer-facing reads show these units as available; the next
 * checkout settles those attempts through PayPal before it takes the stock
 * (settleExpiredHolds in payments/engine.ts). Reads never release anything.
 */
async function expiredUnapprovedHolds(
  offerIds: string[],
  q: Queryable,
): Promise<Map<string, number>> {
  if (offerIds.length === 0) return new Map();
  const rows = await q
    .select({
      offerId: reservation.offerId,
      units: sql<number>`sum(${reservation.quantity})::int`,
    })
    .from(reservation)
    .innerJoin(paymentAttempt, eq(paymentAttempt.quoteId, reservation.quoteId))
    .where(
      and(
        inArray(reservation.offerId, offerIds),
        eq(reservation.state, "held"),
        lt(reservation.expiresAt, sql`now()`),
        eq(paymentAttempt.state, "order_created"),
      ),
    )
    .groupBy(reservation.offerId);
  return new Map(rows.map((row) => [row.offerId, row.units]));
}

function withLiveHolds<
  T extends { offer: OfferRow; stock: InventoryRow | null },
>(rows: T[], expired: Map<string, number>): T[] {
  return rows.map((row) =>
    row.stock
      ? {
          ...row,
          stock: {
            ...row.stock,
            held: row.stock.held - (expired.get(row.offer.id) ?? 0),
          },
        }
      : row,
  );
}

/**
 * Reasons an offer cannot be published, in the owner's words. Empty means publishable.
 * Kept pure so tests and the readiness screen share one rulebook.
 */
export function publishBlockers(
  sellerRow: SellerRow,
  row: Pick<
    OfferRow,
    "kind" | "currency" | "serviceScope" | "digitalAssetId" | "accessDays"
  >,
  stock: InventoryRow | undefined,
): string[] {
  const blockers: string[] = [];
  if (row.currency !== sellerRow.currency)
    blockers.push(`Price currency must be ${sellerRow.currency}.`);
  if (!sellerRow.taxPolicy)
    blockers.push(
      "Add a tax statement in Settings (for example, “Prices include sales tax.”).",
    );
  if (row.kind === "goods") {
    if (!sellerRow.pickupPolicy)
      blockers.push(
        "Add a pickup policy in Settings. Delivery is not supported yet.",
      );
    if (!stock) blockers.push("Set how many are in stock.");
  }
  if (row.kind === "service") {
    if (!row.serviceScope) blockers.push("Describe what the service includes.");
    if (!sellerRow.serviceRequestPolicy)
      blockers.push("Add a service request policy in Settings.");
  }
  if (row.kind === "digital") {
    if (!row.digitalAssetId) blockers.push("Upload the file buyers receive.");
    if (!row.accessDays)
      blockers.push("Set how many days buyers can download.");
    if (!sellerRow.digitalAccessPolicy)
      blockers.push("Add digital access terms in Settings.");
  }
  return blockers;
}

/** Published offers with live availability, ordered for display. */
export async function listPublishedOffers(
  sellerId: string,
  q?: Queryable,
): Promise<PublicOffer[]> {
  const backend = getStorage();
  if (!q && backend.kind === "d1")
    return backend.catalog.listPublishedOffers(sellerId);
  q ??= getDb();

  const rows = await q
    .select({ offer, stock: inventory })
    .from(offer)
    .leftJoin(inventory, eq(inventory.offerId, offer.id))
    .where(and(eq(offer.sellerId, sellerId), eq(offer.published, true)))
    .orderBy(asc(offer.sortOrder), asc(offer.createdAt));
  const expired = await expiredUnapprovedHolds(
    rows.map((row) => row.offer.id),
    q,
  );
  return withLiveHolds(rows, expired).map(({ offer: row, stock }) =>
    toPublicOffer(row, stock ?? undefined),
  );
}

export function toPublicOffer(
  row: OfferRow,
  stock: InventoryRow | undefined,
): PublicOffer {
  return {
    id: row.id,
    revision: row.revision,
    kind: row.kind,
    title: row.title,
    description: row.description,
    unitAmountMinor: row.unitAmountMinor,
    currency: row.currency,
    fulfillmentNote: row.fulfillmentNote,
    requiresScopeReview: row.requiresScopeReview,
    serviceScope: row.serviceScope,
    accessDays: row.accessDays,
    maxQuantity: row.maxQuantity,
    available: row.kind === "goods" ? availableUnits(stock) : null,
    imagePath: row.imagePath,
  };
}

/** Every offer for the owner's catalog screen, published or not. */
export async function listOwnerOffers(owner: OwnerPrincipal, q?: Queryable) {
  const backend = getStorage();
  if (!q && backend.kind === "d1")
    return backend.catalog.listOwnerOffers(owner);
  q ??= getDb();

  const rows = await q
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
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const OfferInput = z
  .object({
    id: z.uuid().optional(),
    expectedRevision: z.number().int().min(1).optional(),
    kind: z.enum(OFFER_KINDS),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    unitAmountMinor: z.number().int().min(1).max(10_000_000).nullable(),
    fulfillmentNote: z.string().trim().max(500),
    requiresScopeReview: z.boolean(),
    serviceScope: nullableText(1000),
    accessDays: z.number().int().min(1).max(3650).nullable(),
    digitalAssetId: z.uuid().nullable(),
    maxQuantity: z.number().int().min(1).max(100),
    stockTotal: z.number().int().min(0).max(100_000).nullable(),
    /** Product photo under /shop/; omitted keeps the current photo. */
    imagePath: z
      .string()
      .regex(
        /^\/shop\/[a-z0-9-]{1,60}\.(webp|png|jpg)$/,
        "Photos must be files in the shop's /shop/ folder.",
      )
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.unitAmountMinor !== null ||
      (value.kind === "service" && value.requiresScopeReview),
    {
      message:
        "A price is required unless this is a service quoted after seller review.",
      path: ["unitAmountMinor"],
    },
  );

export type OfferInput = z.input<typeof OfferInput>;

/**
 * Creates or edits an offer. Edits require the revision the owner saw and bump it,
 * so quotes made from the old revision must be re-reviewed before payment.
 */
export async function saveOffer(
  owner: OwnerPrincipal,
  sellerRow: SellerRow,
  raw: OfferInput,
): Promise<OfferRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.catalog.saveOffer(owner, sellerRow, raw);

  return transaction(getDb(), (tx) =>
    saveOfferInTransaction(tx, owner, sellerRow, raw),
  );
}

/** Saves an offer within the caller's transaction, including its inventory and audit. */
/**
 * Catalog writes share-lock the shop row. Learned-knowledge publication takes the
 * same row for update and checks the catalog before committing, so it waits for an
 * in-flight product edit and then sees it. Edits still run alongside each other.
 */
async function lockShopForCatalogWrite(
  tx: Tx,
  owner: OwnerPrincipal,
): Promise<void> {
  const [shop] = await tx
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    )
    .for("share");
  if (!shop) throw notFound("shop");
}

export async function saveOfferInTransaction(
  tx: Tx,
  owner: OwnerPrincipal,
  sellerRow: SellerRow,
  raw: OfferInput,
): Promise<OfferRow> {
  if (sellerRow.id !== owner.sellerId) throw notFound("shop");
  const input = OfferInput.parse(raw);
  await lockShopForCatalogWrite(tx, owner);
  if (input.kind === "goods" && input.stockTotal === null)
    throw invalid("Set how many are in stock.");
  if (input.digitalAssetId) {
    const [asset] = await tx
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
    currency: sellerRow.currency,
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
    ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
  };

  let saved: OfferRow;
  if (!input.id) {
    const [created] = await tx
      .insert(offer)
      .values({ ...values, sellerId: owner.sellerId, published: false })
      .returning();
    saved = created as OfferRow;
  } else {
    const [current] = await tx
      .select()
      .from(offer)
      .where(and(eq(offer.id, input.id), eq(offer.sellerId, owner.sellerId)))
      .for("update");
    if (!current) throw notFound("offer");
    if (current.revision !== input.expectedRevision) {
      throw conflict(
        "This offer changed in another tab. Reload to see the latest version.",
      );
    }
    if (current.kind !== input.kind && current.published) {
      throw invalid("Unpublish the offer before changing its type.");
    }
    const [updated] = await tx
      .update(offer)
      .set({ ...values, revision: current.revision + 1 })
      .where(eq(offer.id, current.id))
      .returning();
    saved = updated as OfferRow;
  }

  if (input.kind === "goods" && input.stockTotal !== null) {
    const [stock] = await tx
      .select()
      .from(inventory)
      .where(eq(inventory.offerId, saved.id))
      .for("update");
    if (!stock) {
      await tx
        .insert(inventory)
        .values({ offerId: saved.id, total: input.stockTotal });
    } else {
      if (input.stockTotal < stock.held + stock.sold) {
        throw invalid(
          `Stock cannot go below ${stock.held + stock.sold}: ${stock.sold} sold and ${stock.held} held for checkouts in progress.`,
        );
      }
      await tx
        .update(inventory)
        .set({ total: input.stockTotal })
        .where(eq(inventory.offerId, saved.id));
    }
  }

  if (saved.published) {
    const [stock] = await tx
      .select()
      .from(inventory)
      .where(eq(inventory.offerId, saved.id));
    const blockers = publishBlockers(sellerRow, saved, stock);
    if (blockers.length > 0)
      throw invalid(
        `This change would leave a published offer incomplete: ${blockers.join(" ")}`,
      );
  }

  await recordAudit(tx, {
    actor: "owner",
    actorId: owner.userId,
    operation: input.id ? "offer.update" : "offer.create",
    targetType: "offer",
    targetId: saved.id,
    outcome: "ok",
    details: { revision: saved.revision, kind: saved.kind },
  });
  return saved;
}

/** Publishes or unpublishes one offer at the revision the owner reviewed. */
export async function setOfferPublished(
  owner: OwnerPrincipal,
  sellerRow: SellerRow,
  input: { offerId: string; expectedRevision: number; published: boolean },
): Promise<OfferRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.catalog.setOfferPublished(owner, sellerRow, input);

  return transaction(getDb(), async (tx) => {
    await lockShopForCatalogWrite(tx, owner);
    const [current] = await tx
      .select()
      .from(offer)
      .where(
        and(eq(offer.id, input.offerId), eq(offer.sellerId, owner.sellerId)),
      )
      .for("update");
    if (!current) throw notFound("offer");
    if (current.revision !== input.expectedRevision) {
      throw conflict(
        "This offer changed after you reviewed it. Reload and review it again.",
      );
    }
    if (input.published) {
      const [stock] = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.offerId, current.id));
      const blockers = publishBlockers(sellerRow, current, stock);
      if (blockers.length > 0) throw invalid(blockers.join(" "));
    }
    const [updated] = await tx
      .update(offer)
      .set({ published: input.published })
      .where(eq(offer.id, current.id))
      .returning();
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: input.published ? "offer.publish" : "offer.unpublish",
      targetType: "offer",
      targetId: current.id,
      outcome: "ok",
      details: { revision: current.revision },
    });
    return updated as OfferRow;
  });
}

/** Loads offers by id for quoting, scoped to the seller, with only live holds counted. */
export async function loadOffersForQuote(
  sellerId: string,
  offerIds: string[],
  q: Queryable,
) {
  if (offerIds.length === 0) return [];
  const rows = await q
    .select({ offer, stock: inventory })
    .from(offer)
    .leftJoin(inventory, eq(inventory.offerId, offer.id))
    .where(and(eq(offer.sellerId, sellerId), inArray(offer.id, offerIds)));
  return withLiveHolds(rows, await expiredUnapprovedHolds(offerIds, q));
}
