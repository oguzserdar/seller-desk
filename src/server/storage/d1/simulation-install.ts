import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  assistantProcedure,
  assistantProcedureVersion,
  digitalAsset,
  inventory,
  offer,
  seller,
  shopGuide,
  user,
} from "@/server/db/sqlite/schema";
import { conflict } from "@/server/domain/errors";
import { getRequestScope } from "@/server/request-scope";
import type { SimulationInstallation } from "@/server/simulation/install-snapshot";
import type { SimulationShopSnapshot } from "@/server/simulation/snapshot";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, isBatchGuardFailure } from "./guards";

/** Installs an allowlisted snapshot in one native batch, refusing any occupied or non-fictional target. */
export async function installD1SimulationShop(
  db: D1Db,
  snapshot: SimulationShopSnapshot,
): Promise<SimulationInstallation> {
  if (!getRequestScope()?.simulation)
    throw new Error(
      "Shop simulation setup requires an isolated simulation scope.",
    );
  const owner = {
      kind: "owner" as const,
      userId: crypto.randomUUID(),
      sellerId: crypto.randomUUID(),
    },
    ids = new Map(
      snapshot.products.map((p) => [p.sourceId, crypto.randomUUID()]),
    );
  const assetId = snapshot.products.some((p) => p.kind === "digital")
      ? crypto.randomUUID()
      : null,
    bytes = Buffer.from(
      "SELLER DESK SIMULATION\nThis is a fictional download for a private test. No purchase was made and this is not the seller's actual product file.\n",
    );
  const products = snapshot.products.map(
    ({ sourceId, available, ...product }) => ({
      ...product,
      id: ids.get(sourceId)!,
      available,
      digitalAssetId: product.kind === "digital" ? assetId : null,
    }),
  );
  const guides = snapshot.guides.map(
    ({ sourceId: _sourceId, productId, validUntil, ...guide }) => ({
      ...guide,
      id: crypto.randomUUID(),
      productId: productId ? ids.get(productId)! : null,
      validUntil: validUntil ? new Date(validUntil).getTime() : null,
    }),
  );
  const procedures = snapshot.procedures.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
  }));
  const jp = sql`json_each(${JSON.stringify(products)}) j`,
    jg = sql`json_each(${JSON.stringify(guides)}) j`,
    jr = sql`json_each(${JSON.stringify(procedures)}) j`;
  const value = <T>(key: string) =>
    sql<T>`json_extract(j.value,${`$.${key}`})`.as(
      key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
    );
  const execution = crypto.randomUUID();
  try {
    await db.batch([
      batchGuard(
        db,
        `${execution}:fresh`,
        sql`exists(select 1 from installation where singleton=1 and environment='fixture') and not exists(select 1 from seller) and not exists(select 1 from user)`,
      ),
      db
        .insert(user)
        .values({
          id: owner.userId,
          name: "Simulation owner",
          email: "simulation-owner@example.test",
        }),
      db
        .insert(seller)
        .values({
          ...snapshot.shop,
          id: owner.sellerId,
          ownerUserId: owner.userId,
          contactEmail: "simulation-contact@example.test",
          allowedOrigins: [],
        }),
      ...(assetId
        ? [
            db
              .insert(digitalAsset)
              .values({
                id: assetId,
                sellerId: owner.sellerId,
                filename: "simulation-download.txt",
                mimeType: "text/plain",
                sizeBytes: bytes.length,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                bytes,
              }),
          ]
        : []),
      ...(products.length
        ? [
            db
              .insert(offer)
              .select(
                db
                  .select({
                    id: value<string>("id"),
                    sellerId: sql<string>`${owner.sellerId}`.as("seller_id"),
                    kind: value<"goods" | "service" | "digital">("kind"),
                    revision: value<number>("revision"),
                    published: sql<boolean>`1`.as("published"),
                    title: value<string>("title"),
                    description: value<string>("description"),
                    unitAmountMinor: value<number>("unitAmountMinor"),
                    currency: value<string>("currency"),
                    fulfillmentNote: value<string>("fulfillmentNote"),
                    requiresScopeReview: value<boolean>("requiresScopeReview"),
                    serviceScope: value<string>("serviceScope"),
                    digitalAssetId: value<string>("digitalAssetId"),
                    accessDays: value<number>("accessDays"),
                    maxQuantity: value<number>("maxQuantity"),
                    sortOrder: value<number>("sortOrder"),
                    imagePath: value<string>("imagePath"),
                    createdAt: nowMilliseconds.as("created_at"),
                    updatedAt: nowMilliseconds.as("updated_at"),
                  })
                  .from(jp),
              ),
            db.insert(inventory).select(
              db
                .select({
                  offerId: sql<string>`json_extract(j.value,'$.id')`.as(
                    "offer_id",
                  ),
                  total: sql<number>`json_extract(j.value,'$.available')`.as(
                    "total",
                  ),
                  held: sql<number>`0`.as("held"),
                  sold: sql<number>`0`.as("sold"),
                  updatedAt: nowMilliseconds.as("updated_at"),
                })
                .from(jp)
                .where(sql`json_extract(j.value,'$.kind')='goods'`),
            ),
          ]
        : []),
      ...(guides.length
        ? [
            db
              .insert(shopGuide)
              .select(
                db
                  .select({
                    id: value<string>("id"),
                    sellerId: sql<string>`${owner.sellerId}`.as("seller_id"),
                    title: value<string>("title"),
                    topic: value<"general">("topic"),
                    body: value<string>("body"),
                    actionLabel: sql<string>`null`.as("action_label"),
                    actionUrl: sql<string>`null`.as("action_url"),
                    published: sql<boolean>`1`.as("published"),
                    productId: value<string>("productId"),
                    validUntil: value<Date>("validUntil"),
                    archived: sql<boolean>`0`.as("archived"),
                    revision: value<number>("revision"),
                    createdAt: nowMilliseconds.as("created_at"),
                    updatedAt: nowMilliseconds.as("updated_at"),
                  })
                  .from(jg),
              ),
          ]
        : []),
      ...(procedures.length
        ? [
            db
              .insert(assistantProcedure)
              .select(
                db
                  .select({
                    id: value<string>("id"),
                    sellerId: sql<string>`${owner.sellerId}`.as("seller_id"),
                    revision: value<number>("revision"),
                    content:
                      value<
                        import("@/lib/assistant-procedure").ProcedureContent
                      >("content"),
                    publishedRevision:
                      sql<number>`json_extract(j.value,'$.revision')`.as(
                        "published_revision",
                      ),
                    archived: sql<boolean>`0`.as("archived"),
                    createdAt: nowMilliseconds.as("created_at"),
                    updatedAt: nowMilliseconds.as("updated_at"),
                  })
                  .from(jr),
              ),
            db
              .insert(assistantProcedureVersion)
              .select(
                db
                  .select({
                    procedureId: sql<string>`json_extract(j.value,'$.id')`.as(
                      "procedure_id",
                    ),
                    sellerId: sql<string>`${owner.sellerId}`.as("seller_id"),
                    revision: value<number>("revision"),
                    content:
                      value<
                        import("@/lib/assistant-procedure").ProcedureContent
                      >("content"),
                    createdAt: nowMilliseconds.as("created_at"),
                  })
                  .from(jr),
              ),
          ]
        : []),
      clearBatchGuards(db, execution),
    ]);
    return { owner, offerIds: ids };
  } catch (error) {
    if (isBatchGuardFailure(error))
      throw conflict(
        "This simulation database is not an empty fixture target. Previous records are preserved.",
      );
    throw error;
  }
}
