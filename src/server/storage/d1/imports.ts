import { AddDraftsInput } from "@/server/ai/draft-setup";
import { nowMilliseconds, uuidDefault } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  importDraft,
  inventory,
  offer,
} from "@/server/db/sqlite/schema";
import { conflict, notFound } from "@/server/domain/errors";
import {
  ImportReviewInput,
  parseOfferList,
} from "@/server/domain/offer-import";
import { OfferInput } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import type { SellerRow } from "@/server/domain/seller";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

// This is one native catalog command, not a SQL translator. JSON tables keep
// 50 reviewed products below D1's 100 parameter and 50 statement limits.
function offerWrites(
  db: D1Db,
  owner: OwnerPrincipal,
  shop: SellerRow,
  inputs: OfferInput[],
) {
  if (!inputs.length) return [];
  const rows = inputs.map((raw) => ({
    ...OfferInput.parse(raw),
    id: crypto.randomUUID(),
  }));
  const j = sql`json_each(${JSON.stringify(rows)}) j`;
  const text = (key: string) =>
    sql<string>`json_extract(j.value,${`$.${key}`})`;
  const number = (key: string) =>
    sql<number>`json_extract(j.value,${`$.${key}`})`;
  const insert = db.insert(offer).select(
    db
      .select({
        id: text("id").as("id"),
        sellerId: sql<string>`${owner.sellerId}`.as("seller_id"),
        kind: text("kind").as("kind"),
        revision: sql<number>`1`.as("revision"),
        published: sql<boolean>`0`.as("published"),
        title: text("title").as("title"),
        description: text("description").as("description"),
        unitAmountMinor: number("unitAmountMinor").as("unit_amount_minor"),
        currency: sql<string>`${shop.currency}`.as("currency"),
        fulfillmentNote: text("fulfillmentNote").as("fulfillment_note"),
        requiresScopeReview: sql<boolean>`0`.as("requires_scope_review"),
        serviceScope: text("serviceScope").as("service_scope"),
        digitalAssetId: sql<string>`null`.as("digital_asset_id"),
        accessDays: number("accessDays").as("access_days"),
        maxQuantity: number("maxQuantity").as("max_quantity"),
        sortOrder: sql<number>`0`.as("sort_order"),
        imagePath: sql<string>`null`.as("image_path"),
        createdAt: nowMilliseconds.as("created_at"),
        updatedAt: nowMilliseconds.as("updated_at"),
      })
      .from(j),
  );
  const stock = db.insert(inventory).select(
    db
      .select({
        offerId: text("id").as("offer_id"),
        total: number("stockTotal").as("total"),
        held: sql<number>`0`.as("held"),
        sold: sql<number>`0`.as("sold"),
        updatedAt: nowMilliseconds.as("updated_at"),
      })
      .from(j)
      .where(sql`json_extract(j.value,'$.kind')='goods'`),
  );
  const audit = db
    .insert(auditEvent)
    .select(
      db
        .select({
          id: uuidDefault.as("id"),
          actor: sql<"owner">`'owner'`.as("actor"),
          actorId: sql<string>`${owner.userId}`.as("actor_id"),
          operation: sql<string>`'offer.create'`.as("operation"),
          targetType: sql<string>`'offer'`.as("target_type"),
          targetId: text("id").as("target_id"),
          outcome: sql<"ok">`'ok'`.as("outcome"),
          details:
            sql<{}>`json_object('revision',1,'kind',json_extract(j.value,'$.kind'))`.as(
              "details",
            ),
          createdAt: nowMilliseconds.as("created_at"),
        })
        .from(j),
    );
  return [insert, stock, audit];
}

/** Reviewed catalog imports commit once, atomically, with all products left unpublished. */
export function createD1Imports(db: D1Db) {
  async function draft(owner: OwnerPrincipal, id: string, revision: number) {
    const [row] = await db
      .select()
      .from(importDraft)
      .where(
        and(
          eq(importDraft.id, id),
          eq(importDraft.sellerId, owner.sellerId),
          ownerScope(owner),
        ),
      );
    if (!row) throw notFound("draft");
    if (row.status !== "draft" || row.reviewRevision !== revision)
      throw conflict(
        "These drafts were already added or changed. Preview again to start over.",
      );
    return row;
  }
  async function commit(
    owner: OwnerPrincipal,
    shop: SellerRow,
    row: typeof importDraft.$inferSelect,
    inputs: OfferInput[],
    skipped: number,
    assisted: boolean,
  ) {
    const execution = crypto.randomUUID();
    try {
      await db.batch([
        batchGuard(
          db,
          `${execution}:review`,
          sql`${ownerScope(owner)} and exists(select 1 from seller where id=${shop.id} and currency=${shop.currency}) and exists(select 1 from import_draft where id=${row.id} and seller_id=${owner.sellerId} and status='draft' and review_revision=${row.reviewRevision} and source_hash=${row.sourceHash})`,
        ),
        db
          .update(importDraft)
          .set({
            status: "published",
            reviewRevision: row.reviewRevision + 1,
            updatedAt: new Date(),
          })
          .where(eq(importDraft.id, row.id)),
        ...offerWrites(db, owner, shop, inputs),
        ...(assisted
          ? [
              db
                .insert(auditEvent)
                .values({
                  actor: "owner",
                  actorId: owner.userId,
                  operation: "add_drafted_offers",
                  targetType: "import_draft",
                  targetId: row.id,
                  outcome: "ok",
                  details: { created: inputs.length },
                }),
            ]
          : []),
        clearBatchGuards(db, execution),
      ]);
      return { created: inputs.length, skipped };
    } catch (error) {
      if (isBatchGuardFailure(error))
        throw conflict(
          "This preview changed. Preview again before adding products.",
        );
      throw error;
    }
  }
  return {
    async saveDraft(
      owner: OwnerPrincipal,
      values: typeof importDraft.$inferInsert,
      assisted = false,
    ) {
      const execution = crypto.randomUUID(),
        id = crypto.randomUUID();
      const [, rows] = await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db
          .insert(importDraft)
          .values({ ...values, id, sellerId: owner.sellerId })
          .returning(),
        ...(assisted
          ? [
              db
                .insert(auditEvent)
                .values({
                  actor: "assistant",
                  actorId: owner.userId,
                  operation: "draft_offers",
                  targetType: "import_draft",
                  targetId: id,
                  outcome: "ok",
                  details: { drafts: values.proposed.length },
                }),
            ]
          : []),
        clearBatchGuards(db, execution),
      ]);
      return rows[0]!;
    },
    async importOfferDrafts(
      owner: OwnerPrincipal,
      shop: SellerRow,
      raw: z.input<typeof ImportReviewInput>,
    ) {
      if (shop.id !== owner.sellerId) throw notFound("shop");
      const input = ImportReviewInput.parse(raw),
        row = await draft(owner, input.draftId, input.reviewRevision);
      if (
        row.sourceKind !== "csv" ||
        row.generator !== "csv-parse:7.0.3:catalog-v1"
      )
        throw conflict("Preview the file again.");
      if (
        createHash("sha256")
          .update(`${shop.currency}\n${row.sourceText}`)
          .digest("hex") !== row.sourceHash
      )
        throw conflict(
          "The shop currency changed. Preview the file again before adding products.",
        );
      const parsed = parseOfferList(row.sourceText, shop.currency),
        inputs: OfferInput[] = parsed
          .filter((r) => !r.problem && r.unitAmountMinor !== null)
          .map((r) => ({
            kind: r.kind,
            title: r.title,
            description: r.title,
            unitAmountMinor: r.unitAmountMinor!,
            fulfillmentNote: "",
            requiresScopeReview: false,
            serviceScope: null,
            accessDays: r.kind === "digital" ? 30 : null,
            digitalAssetId: null,
            maxQuantity:
              r.kind === "goods" ? Math.min(10, Math.max(1, r.stock ?? 1)) : 1,
            stockTotal: r.kind === "goods" ? (r.stock ?? 0) : null,
          }));
      return commit(
        owner,
        shop,
        row,
        inputs,
        parsed.length - inputs.length,
        false,
      );
    },
    async addDraftedOffers(
      owner: OwnerPrincipal,
      shop: SellerRow,
      raw: z.infer<typeof AddDraftsInput>,
    ) {
      if (shop.id !== owner.sellerId) throw notFound("shop");
      const input = AddDraftsInput.parse(raw),
        row = await draft(owner, input.draftId, input.reviewRevision),
        choices = new Map(input.choices.map((choice) => [choice.key, choice]));
      const inputs: OfferInput[] = [];
      for (const item of row.proposed) {
        const choice = choices.get(item.key);
        if (
          !choice?.include ||
          item.title.value === null ||
          item.priceMinor.value === null
        )
          continue;
        const kind = choice.kind,
          stock = item.stock.value;
        inputs.push({
          kind,
          title: item.title.value,
          description: item.description.value ?? item.title.value,
          unitAmountMinor: item.priceMinor.value,
          fulfillmentNote: "",
          requiresScopeReview: false,
          serviceScope: kind === "service" ? item.serviceScope.value : null,
          accessDays: kind === "digital" ? 30 : null,
          digitalAssetId: null,
          maxQuantity:
            kind === "goods" ? Math.min(10, Math.max(1, stock ?? 1)) : 1,
          stockTotal: kind === "goods" ? (stock ?? 0) : null,
        });
      }
      return commit(
        owner,
        shop,
        row,
        inputs,
        row.proposed.length - inputs.length,
        true,
      );
    },
  };
}
