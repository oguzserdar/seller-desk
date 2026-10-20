import { GUIDE_LIMIT, GuideInput, publicShopUrl } from "@/lib/shop-guide";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  offer,
  seller,
  shopGuide,
  shopGuideVersion,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { guideSnapshot, type GuideRow } from "@/server/domain/shop-guide";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

const room = (owner: OwnerPrincipal) =>
  sql`(select count(*) from shop_guide where seller_id=${owner.sellerId} and archived=0)<${GUIDE_LIMIT}`;
async function hasRoom(db: D1Db, owner: OwnerPrincipal) {
  const [total] = await db
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
}
async function productScope(
  db: D1Db,
  owner: OwnerPrincipal,
  id: string | null,
) {
  if (
    id &&
    !(
      await db
        .select({ id: offer.id })
        .from(offer)
        .where(and(eq(offer.id, id), eq(offer.sellerId, owner.sellerId)))
    )[0]
  )
    throw notFound("product in this shop");
}

/** A named guide-save plan can commit with its learning-publication receipt in the same native batch. */
export async function prepareD1GuideSave(
  db: D1Db,
  owner: OwnerPrincipal,
  raw: GuideInput,
) {
  if (
    !(
      await db
        .select({ id: seller.id })
        .from(seller)
        .where(and(eq(seller.id, owner.sellerId), ownerScope(owner)))
    )[0]
  )
    throw notFound("shop");
  const input = GuideInput.parse(raw),
    validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (input.published && validUntil && validUntil <= new Date())
    throw invalid("Choose a future expiry before publishing this fact.");
  await productScope(db, owner, input.productId);
  const [current] = input.id
    ? await db
        .select()
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.id, input.id),
            eq(shopGuide.sellerId, owner.sellerId),
          ),
        )
    : [];
  if (input.id && !current) throw notFound("shop knowledge entry");
  if (current?.archived)
    throw conflict(
      "Restore a saved version before editing this removed entry.",
    );
  if (current && current.revision !== input.expectedRevision)
    throw conflict("This entry changed. Reload before saving.");
  if (!current) await hasRoom(db, owner);
  const row: GuideRow = {
    id: current?.id ?? crypto.randomUUID(),
    sellerId: owner.sellerId,
    title: input.title,
    topic: input.topic,
    body: input.body,
    published: input.published,
    productId: input.productId,
    validUntil,
    actionLabel: input.actionLabel || null,
    actionUrl: input.actionUrl ? publicShopUrl(input.actionUrl) : null,
    archived: false,
    revision: (current?.revision ?? 0) + 1,
    createdAt: current?.createdAt ?? new Date(),
    updatedAt: new Date(),
  };
  const guard = sql`${ownerScope(owner)} and ${current ? sql`exists(select 1 from shop_guide where id=${current.id} and seller_id=${owner.sellerId} and revision=${current.revision} and archived=0)` : room(owner)}
    and ${row.productId ? sql`exists(select 1 from offer where id=${row.productId} and seller_id=${owner.sellerId})` : sql`1`}
    and ${row.published && row.validUntil ? sql`${row.validUntil.getTime()}>${nowMilliseconds}` : sql`1`}`;
  return {
    row,
    guard,
    writes: [
      current
        ? db.update(shopGuide).set(row).where(eq(shopGuide.id, row.id))
        : db.insert(shopGuide).values(row),
      db
        .insert(shopGuideVersion)
        .values({
          guideId: row.id,
          sellerId: owner.sellerId,
          revision: row.revision,
          snapshot: guideSnapshot(row),
        }),
      db
        .insert(auditEvent)
        .values({
          actor: "owner",
          actorId: owner.userId,
          operation: "shop_guide.save",
          targetType: "shop_guide",
          targetId: row.id,
          outcome: "ok",
          details: { revision: row.revision, published: row.published },
        }),
    ],
  };
}

/** Native guide writes retain immutable snapshots and require explicit publication. */
export function createD1GuideWrites(db: D1Db) {
  return {
    async saveGuide(owner: OwnerPrincipal, raw: GuideInput): Promise<GuideRow> {
      const plan = await prepareD1GuideSave(db, owner, raw),
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(db, `${execution}:guide`, plan.guard),
          ...plan.writes,
          clearBatchGuards(db, execution),
        ]);
        return plan.row;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This entry or the active knowledge limit changed. Reload before saving.",
          );
        throw error;
      }
    },
    async removeGuide(
      owner: OwnerPrincipal,
      id: string,
      expectedRevision: number,
    ): Promise<void> {
      z.uuid().parse(id);
      z.number().int().positive().parse(expectedRevision);
      const [current] = await db
        .select()
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.id, id),
            eq(shopGuide.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!current) throw notFound("shop knowledge entry");
      if (current.revision !== expectedRevision)
        throw conflict("This entry changed. Reload before removing it.");
      if (current.archived) throw conflict("This entry was already removed.");
      const row = {
          ...current,
          archived: true,
          published: false,
          revision: current.revision + 1,
          updatedAt: new Date(),
        },
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:remove`,
            sql`${ownerScope(owner)} and exists(select 1 from shop_guide where id=${id} and seller_id=${owner.sellerId} and revision=${expectedRevision} and archived=0)`,
          ),
          db.update(shopGuide).set(row).where(eq(shopGuide.id, id)),
          db
            .insert(shopGuideVersion)
            .values({
              guideId: id,
              sellerId: owner.sellerId,
              revision: row.revision,
              snapshot: guideSnapshot(row),
            }),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "shop_guide.remove",
              targetType: "shop_guide",
              targetId: id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict("This entry changed. Reload before removing it.");
        throw error;
      }
    },
    async restoreGuideVersion(
      owner: OwnerPrincipal,
      id: string,
      expectedRevision: number,
      restoreRevision: number,
    ): Promise<GuideRow> {
      z.uuid().parse(id);
      z.number().int().positive().parse(expectedRevision);
      z.number().int().positive().parse(restoreRevision);
      const [current] = await db
        .select()
        .from(shopGuide)
        .where(
          and(
            eq(shopGuide.id, id),
            eq(shopGuide.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!current) throw notFound("shop knowledge entry");
      if (current.revision !== expectedRevision)
        throw conflict(
          "This entry changed. Reload before restoring a version.",
        );
      const [saved] = await db
        .select()
        .from(shopGuideVersion)
        .where(
          and(
            eq(shopGuideVersion.guideId, id),
            eq(shopGuideVersion.sellerId, owner.sellerId),
            eq(shopGuideVersion.revision, restoreRevision),
          ),
        );
      if (!saved) throw notFound("saved version");
      if (current.archived) await hasRoom(db, owner);
      const { archived: _removed, ...fields } = saved.snapshot,
        input = GuideInput.parse({
          ...fields,
          id,
          expectedRevision,
          published: false,
        });
      await productScope(db, owner, input.productId);
      const row: GuideRow = {
          ...current,
          title: input.title,
          body: input.body,
          topic: input.topic,
          actionLabel: input.actionLabel || null,
          actionUrl: input.actionUrl ? publicShopUrl(input.actionUrl) : null,
          productId: input.productId,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          archived: false,
          published: false,
          revision: current.revision + 1,
          updatedAt: new Date(),
        },
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:restore`,
            sql`${ownerScope(owner)} and exists(select 1 from shop_guide where id=${id} and seller_id=${owner.sellerId} and revision=${expectedRevision}) and ${current.archived ? room(owner) : sql`1`} and ${row.productId ? sql`exists(select 1 from offer where id=${row.productId} and seller_id=${owner.sellerId})` : sql`1`}`,
          ),
          db.update(shopGuide).set(row).where(eq(shopGuide.id, id)),
          db
            .insert(shopGuideVersion)
            .values({
              guideId: id,
              sellerId: owner.sellerId,
              revision: row.revision,
              snapshot: guideSnapshot(row),
            }),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "shop_guide.restore",
              targetType: "shop_guide",
              targetId: id,
              outcome: "ok",
              details: {
                revision: row.revision,
                restoredFrom: restoreRevision,
              },
            }),
          clearBatchGuards(db, execution),
        ]);
        return row;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This entry changed. Reload before restoring a version.",
          );
        throw error;
      }
    },
  };
}
