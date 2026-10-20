import {
  GUIDE_LIMIT,
  GuideInput,
  publicShopUrl,
  type GuideHistoryItem,
  type GuideSnapshot,
  type GuideSource,
  type ShopStep,
} from "@/lib/shop-guide";
import {
  getDb,
  transaction,
  type Queryable,
  type Tx,
} from "@/server/db/client";
import { offer, seller, shopGuide, shopGuideVersion } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

/** Owner-only record, including unpublished content and the approved destination. */
export type GuideRow = typeof shopGuide.$inferSelect;

async function assertOwner(owner: OwnerPrincipal, db: Queryable, lock = false) {
  const query = db
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("shop");
}

/** Reads entries only for the authenticated owner of this shop. */
export async function listOwnerGuide(
  owner: OwnerPrincipal,
  includeArchived = false,
): Promise<GuideRow[]> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.listOwnerGuide(owner, includeArchived);

  const db = getDb();
  await assertOwner(owner, db);
  return db
    .select()
    .from(shopGuide)
    .where(
      and(
        eq(shopGuide.sellerId, owner.sellerId),
        includeArchived ? undefined : eq(shopGuide.archived, false),
      ),
    )
    .orderBy(asc(shopGuide.createdAt));
}

/** Explicit version fields, safe for owner forms and durable history. */
export function guideSnapshot(row: GuideRow): GuideSnapshot {
  return {
    title: row.title,
    topic: row.topic,
    body: row.body,
    actionLabel: row.actionLabel ?? "",
    actionUrl: row.actionUrl ?? "",
    published: row.published,
    productId: row.productId,
    validUntil: row.validUntil?.toISOString() ?? null,
    archived: row.archived,
  };
}

async function saveVersion(db: Queryable, row: GuideRow) {
  await db
    .insert(shopGuideVersion)
    .values({
      guideId: row.id,
      sellerId: row.sellerId,
      revision: row.revision,
      snapshot: guideSnapshot(row),
    });
}

async function validateScope(
  db: Queryable,
  sellerId: string,
  productId: string | null,
  published: boolean,
  validUntil: Date | null,
) {
  if (published && validUntil && validUntil <= new Date())
    throw invalid("Choose a future expiry before publishing this fact.");
  if (productId) {
    const [product] = await db
      .select({ id: offer.id })
      .from(offer)
      .where(and(eq(offer.id, productId), eq(offer.sellerId, sellerId)));
    if (!product) throw notFound("product in this shop");
  }
}

const activeGuide = () =>
  and(
    eq(shopGuide.published, true),
    eq(shopGuide.archived, false),
    sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil} > now())`,
  );

/** Saves reviewed facts atomically; the seller lock bounds concurrent additions. */
export async function saveGuide(
  owner: OwnerPrincipal,
  raw: GuideInput,
): Promise<GuideRow> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.guides.saveGuide(owner, raw);

  return transaction(getDb(), (tx) => saveGuideInTransaction(owner, raw, tx));
}

/** Saves a guide and its version within the caller's atomic owner-approved operation. */
export async function saveGuideInTransaction(
  owner: OwnerPrincipal,
  raw: GuideInput,
  tx: Tx,
): Promise<GuideRow> {
  const input = GuideInput.parse(raw);
  await assertOwner(owner, tx, true);
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  await validateScope(
    tx,
    owner.sellerId,
    input.productId,
    input.published,
    validUntil,
  );
  const values = {
    title: input.title,
    topic: input.topic,
    body: input.body,
    published: input.published,
    productId: input.productId,
    validUntil,
    actionLabel: input.actionLabel || null,
    actionUrl: input.actionUrl ? publicShopUrl(input.actionUrl) : null,
  };
  let result: GuideRow | undefined;
  if (input.id) {
    const [current] = await tx
      .select()
      .from(shopGuide)
      .where(
        and(eq(shopGuide.id, input.id), eq(shopGuide.sellerId, owner.sellerId)),
      )
      .for("update");
    if (!current) throw notFound("shop knowledge entry");
    if (current.archived)
      throw conflict(
        "Restore a saved version before editing this removed entry.",
      );
    if (current.revision !== input.expectedRevision)
      throw conflict("This entry changed. Reload before saving.");
    [result] = await tx
      .update(shopGuide)
      .set({ ...values, revision: current.revision + 1 })
      .where(eq(shopGuide.id, current.id))
      .returning();
  } else {
    const [total] = await tx
      .select({ n: count() })
      .from(shopGuide)
      .where(
        and(
          eq(shopGuide.sellerId, owner.sellerId),
          eq(shopGuide.archived, false),
        ),
      );
    if ((total?.n ?? 0) >= GUIDE_LIMIT)
      throw invalid(
        `Keep your shop knowledge to ${GUIDE_LIMIT} focused entries. Edit or remove an existing entry first.`,
      );
    [result] = await tx
      .insert(shopGuide)
      .values({ ...values, sellerId: owner.sellerId })
      .returning();
  }
  if (!result) throw new Error("guide save returned nothing");
  await saveVersion(tx, result);
  await recordAudit(tx, {
    actor: "owner",
    actorId: owner.userId,
    operation: "shop_guide.save",
    targetType: "shop_guide",
    targetId: result.id,
    outcome: "ok",
    details: { revision: result.revision, published: result.published },
  });
  return result;
}

/** Archives an owner's entry, preserving history and invalidating every old action link. */
export async function removeGuide(
  owner: OwnerPrincipal,
  id: string,
  expectedRevision: number,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.removeGuide(owner, id, expectedRevision);

  z.uuid().parse(id);
  z.number().int().positive().parse(expectedRevision);
  await transaction(getDb(), async (tx) => {
    await assertOwner(owner, tx, true);
    const [row] = await tx
      .select()
      .from(shopGuide)
      .where(and(eq(shopGuide.id, id), eq(shopGuide.sellerId, owner.sellerId)))
      .for("update");
    if (!row) throw notFound("shop knowledge entry");
    if (row.revision !== expectedRevision)
      throw conflict("This entry changed. Reload before removing it.");
    if (row.archived) throw conflict("This entry was already removed.");
    const [archived] = await tx
      .update(shopGuide)
      .set({ archived: true, published: false, revision: row.revision + 1 })
      .where(eq(shopGuide.id, row.id))
      .returning();
    await saveVersion(tx, archived!);
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "shop_guide.remove",
      targetType: "shop_guide",
      targetId: id,
      outcome: "ok",
    });
  });
}

/** Returns active shop facts plus rules for the specifically requested published product. */
export async function readShopGuide(
  buyer: BuyerPrincipal,
  productId?: string,
): Promise<{ sources: GuideSource[] }> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.readShopGuide(buyer, productId);

  if (productId) {
    z.uuid().parse(productId);
    const [product] = await getDb()
      .select({ id: offer.id })
      .from(offer)
      .where(
        and(
          eq(offer.id, productId),
          eq(offer.sellerId, buyer.sellerId),
          eq(offer.published, true),
        ),
      );
    if (!product) throw notFound("published product");
  }
  const scope = productId
    ? or(isNull(shopGuide.productId), eq(shopGuide.productId, productId))
    : isNull(shopGuide.productId);
  return readPublicSources(buyer, scope);
}

/** Includes current public rules with a bounded catalog result, rechecking seller and published products. */
export async function readCatalogGuide(
  buyer: BuyerPrincipal,
  productIds: string[],
): Promise<{ sources: GuideSource[] }> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.readCatalogGuide(buyer, productIds);

  z.array(z.uuid()).max(40).parse(productIds);
  const products = getDb()
    .select({ id: offer.id })
    .from(offer)
    .where(
      and(
        eq(offer.sellerId, buyer.sellerId),
        eq(offer.published, true),
        inArray(offer.id, productIds),
      ),
    );
  return readPublicSources(
    buyer,
    or(isNull(shopGuide.productId), inArray(shopGuide.productId, products)),
  );
}

async function readPublicSources(
  buyer: BuyerPrincipal,
  scope: SQL | undefined,
): Promise<{ sources: GuideSource[] }> {
  const rows = await getDb()
    .select()
    .from(shopGuide)
    .where(and(eq(shopGuide.sellerId, buyer.sellerId), activeGuide(), scope))
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

/** Resolves a model-selected source id to an owner-approved action card, without accepting model URLs. */
export async function showShopStep(
  buyer: BuyerPrincipal,
  id: string,
  revision: number,
): Promise<ShopStep> {
  const row = await approvedDestination(buyer.sellerId, id, revision);
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    label: row.actionLabel!,
    host: new URL(row.actionUrl!).hostname,
  };
}

/** Rechecks publication and the exact revision on every click, including links in old chats. */
export async function approvedDestination(
  sellerId: string,
  id: string,
  revision: number,
): Promise<GuideRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.approvedDestination(sellerId, id, revision);

  z.uuid().parse(id);
  z.number().int().positive().parse(revision);
  const [row] = await getDb()
    .select()
    .from(shopGuide)
    .where(
      and(
        eq(shopGuide.id, id),
        eq(shopGuide.sellerId, sellerId),
        eq(shopGuide.revision, revision),
        activeGuide(),
      ),
    );
  if (!row?.actionLabel || !row.actionUrl || !publicShopUrl(row.actionUrl))
    throw notFound("current shop link; ask the assistant for the latest step");
  if (row.productId) {
    const [product] = await getDb()
      .select({ id: offer.id })
      .from(offer)
      .where(
        and(
          eq(offer.id, row.productId),
          eq(offer.sellerId, sellerId),
          eq(offer.published, true),
        ),
      );
    if (!product)
      throw notFound(
        "current shop link; ask the assistant for the latest step",
      );
  }
  return row;
}

/** Returns owner-only immutable versions, including removed entries. */
export async function guideHistory(
  owner: OwnerPrincipal,
  id: string,
): Promise<GuideHistoryItem[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.guides.guideHistory(owner, id);

  z.uuid().parse(id);
  const db = getDb();
  await assertOwner(owner, db);
  const [row] = await db
    .select({ id: shopGuide.id })
    .from(shopGuide)
    .where(and(eq(shopGuide.id, id), eq(shopGuide.sellerId, owner.sellerId)));
  if (!row) throw notFound("shop knowledge entry");
  const versions = await db
    .select()
    .from(shopGuideVersion)
    .where(
      and(
        eq(shopGuideVersion.guideId, id),
        eq(shopGuideVersion.sellerId, owner.sellerId),
      ),
    )
    .orderBy(desc(shopGuideVersion.revision))
    .limit(100);
  return versions.map((version) => ({
    revision: version.revision,
    savedAt: version.createdAt.toISOString(),
    snapshot: version.snapshot,
  }));
}

/** Restores a selected historical snapshot as a new draft; it never silently republishes an old rule. */
export async function restoreGuideVersion(
  owner: OwnerPrincipal,
  id: string,
  expectedRevision: number,
  restoreRevision: number,
): Promise<GuideRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.guides.restoreGuideVersion(
      owner,
      id,
      expectedRevision,
      restoreRevision,
    );

  z.uuid().parse(id);
  z.number().int().positive().parse(expectedRevision);
  z.number().int().positive().parse(restoreRevision);
  return transaction(getDb(), async (tx) => {
    await assertOwner(owner, tx, true);
    const [current] = await tx
      .select()
      .from(shopGuide)
      .where(and(eq(shopGuide.id, id), eq(shopGuide.sellerId, owner.sellerId)))
      .for("update");
    if (!current) throw notFound("shop knowledge entry");
    if (current.revision !== expectedRevision)
      throw conflict("This entry changed. Reload before restoring a version.");
    const [version] = await tx
      .select()
      .from(shopGuideVersion)
      .where(
        and(
          eq(shopGuideVersion.guideId, id),
          eq(shopGuideVersion.sellerId, owner.sellerId),
          eq(shopGuideVersion.revision, restoreRevision),
        ),
      );
    if (!version) throw notFound("saved version");
    if (current.archived) {
      const [total] = await tx
        .select({ n: count() })
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.sellerId, owner.sellerId),
            eq(shopGuide.archived, false),
          ),
        );
      if ((total?.n ?? 0) >= GUIDE_LIMIT)
        throw invalid(
          "Remove an active knowledge entry before restoring this one.",
        );
    }
    const { archived: _archived, ...fields } = version.snapshot;
    const value = GuideInput.parse({
      ...fields,
      id,
      expectedRevision,
      published: false,
    });
    const validUntil = value.validUntil ? new Date(value.validUntil) : null;
    await validateScope(tx, owner.sellerId, value.productId, false, validUntil);
    const [restored] = await tx
      .update(shopGuide)
      .set({
        title: value.title,
        body: value.body,
        topic: value.topic,
        actionLabel: value.actionLabel || null,
        actionUrl: value.actionUrl ? publicShopUrl(value.actionUrl) : null,
        productId: value.productId,
        validUntil,
        archived: false,
        published: false,
        revision: current.revision + 1,
      })
      .where(eq(shopGuide.id, id))
      .returning();
    if (!restored) throw new Error("guide restoration returned nothing");
    await saveVersion(tx, restored);
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "shop_guide.restore",
      targetType: "shop_guide",
      targetId: id,
      outcome: "ok",
      details: { revision: restored.revision, restoredFrom: restoreRevision },
    });
    return restored;
  });
}
