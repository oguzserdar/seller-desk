import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { OFFER_KINDS } from "../constants";
import type { DraftOffer } from "../types";
import {
  boolean,
  createdAt,
  inList,
  scalarChecks,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { digitalAsset, seller } from "./shop";

/** Offer records in the D1 dialect. */
export const offer = sqliteTable(
  "offer",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: OFFER_KINDS }).notNull(),
    revision: integer("revision").default(1).notNull(),
    published: boolean("published").default(false).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    unitAmountMinor: integer("unit_amount_minor"),
    currency: text("currency").notNull(),
    fulfillmentNote: text("fulfillment_note").default("").notNull(),
    requiresScopeReview: boolean("requires_scope_review")
      .default(false)
      .notNull(),
    serviceScope: text("service_scope"),
    digitalAssetId: uuid("digital_asset_id").references(() => digitalAsset.id, {
      onDelete: "restrict",
    }),
    accessDays: integer("access_days"),
    maxQuantity: integer("max_quantity").default(10).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Site-relative product photo, e.g. /shop/front-light.webp. Never an external URL. */
    imagePath: text("image_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("offer", t),
    index("offer_seller_published_idx").on(t.sellerId, t.published),
    check(
      "offer_image_path_local",
      sql`${t.imagePath} is null or (${t.imagePath} glob '/shop/*' and (substr(${t.imagePath}, -5) = '.webp' or substr(${t.imagePath}, -4) in ('.png', '.jpg')) and length(substr(${t.imagePath}, 7, length(${t.imagePath}) - 6 - case when substr(${t.imagePath}, -5) = '.webp' then 5 else 4 end)) between 1 and 60 and substr(${t.imagePath}, 7, length(${t.imagePath}) - 6 - case when substr(${t.imagePath}, -5) = '.webp' then 5 else 4 end) not glob '*[^a-z0-9-]*')`,
    ),
    check("offer_kind_valid", inList("kind", OFFER_KINDS)),
    check(
      "offer_price_range",
      sql`(${t.unitAmountMinor} is not null and ${t.unitAmountMinor} between 1 and 10000000) or (${t.unitAmountMinor} is null and ${t.kind} = 'service' and ${t.requiresScopeReview})`,
    ),
    check(
      "offer_currency_format",
      sql`length(${t.currency}) = 3 and ${t.currency} not glob '*[^A-Z]*'`,
    ),
    check("offer_title_length", sql`length(${t.title}) between 1 and 120`),
    check(
      "offer_description_length",
      sql`length(${t.description}) between 1 and 2000`,
    ),
    check("offer_max_quantity_range", sql`${t.maxQuantity} between 1 and 100`),
    check("offer_revision_positive", sql`${t.revision} >= 1`),
    check(
      "offer_digital_needs_asset",
      sql`${t.kind} <> 'digital' or not ${t.published} or (${t.digitalAssetId} is not null and ${t.accessDays} between 1 and 3650)`,
    ),
    check(
      "offer_service_needs_scope",
      sql`${t.kind} <> 'service' or not ${t.published} or length(coalesce(${t.serviceScope}, '')) > 0`,
    ),
  ],
);

/** Inventory records in the D1 dialect. */
export const inventory = sqliteTable(
  "inventory",
  {
    offerId: uuid("offer_id")
      .primaryKey()
      .references(() => offer.id, { onDelete: "cascade" }),
    total: integer("total").notNull(),
    held: integer("held").default(0).notNull(),
    sold: integer("sold").default(0).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("inventory", t),
    check(
      "inventory_non_negative",
      sql`${t.total} >= 0 and ${t.held} >= 0 and ${t.sold} >= 0`,
    ),
    check("inventory_not_oversold", sql`${t.held} + ${t.sold} <= ${t.total}`),
  ],
);

/** Import draft records in the D1 dialect. */
export const importDraft = sqliteTable(
  "import_draft",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", { enum: ["paste", "csv"] }).notNull(),
    sourceText: text("source_text").notNull(),
    sourceHash: text("source_hash").notNull(),
    status: text("status", { enum: ["draft", "published", "discarded"] })
      .default("draft")
      .notNull(),
    proposed: text("proposed", { mode: "json" })
      .$type<DraftOffer[]>()
      .notNull(),
    reviewRevision: integer("review_revision").default(1).notNull(),
    generator: text("generator").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("import_draft", t),
    check(
      "import_draft_source_length",
      sql`length(${t.sourceText}) between 1 and 20000`,
    ),
    check(
      "import_draft_status_valid",
      inList("status", ["draft", "published", "discarded"]),
    ),
    check("import_draft_kind_valid", inList("source_kind", ["paste", "csv"])),
  ],
);
