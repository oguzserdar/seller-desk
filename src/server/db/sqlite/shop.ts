import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ENVIRONMENTS } from "../constants";
import { user } from "./auth-schema";
import {
  boolean,
  bytea,
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";

/** Installation records in the D1 dialect. */
export const installation = sqliteTable(
  "installation",
  {
    singleton: boolean("singleton").default(true).primaryKey(),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    /** The last real request sent to the configured model from Setup, as provider:model. */
    aiCheckModel: text("ai_check_model"),
    aiCheckOk: boolean("ai_check_ok"),
    aiCheckDetail: text("ai_check_detail"),
    aiCheckedAt: ts("ai_checked_at"),
    /** AI connection saved in Setup, sealed with SETTINGS_ENCRYPTION_KEY; never readable without it. */
    aiSettingsSealed: text("ai_settings_sealed"),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("installation", t),
    check("installation_singleton_true", sql`${t.singleton}`),
    check(
      "installation_environment_valid",
      inList("environment", ENVIRONMENTS),
    ),
  ],
);

/** Seller records in the D1 dialect. */
export const seller = sqliteTable(
  "seller",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    singleton: boolean("singleton").default(true).notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    policyRevision: integer("policy_revision").default(1).notNull(),
    pickupPolicy: text("pickup_policy"),
    serviceRequestPolicy: text("service_request_policy"),
    digitalAccessPolicy: text("digital_access_policy"),
    cancellationPolicy: text("cancellation_policy"),
    taxPolicy: text("tax_policy"),
    allowedOrigins: text("allowed_origins", { mode: "json" })
      .$type<string[]>()
      .default([])
      .notNull(),
    buyerTurnsPer10Min: integer("buyer_turns_per_10_min").default(10).notNull(),
    sellerDailyAiTurns: integer("seller_daily_ai_turns").default(500).notNull(),
    quoteTtlMinutes: integer("quote_ttl_minutes").default(30).notNull(),
    holdTtlMinutes: integer("hold_ttl_minutes").default(15).notNull(),
    /** One of the curated shop palettes in src/lib/shop-themes.ts. */
    theme: text("theme").default("slate").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("seller", t),
    uniqueIndex("seller_singleton_key").on(t.singleton),
    uniqueIndex("seller_owner_key").on(t.ownerUserId),
    check("seller_singleton_true", sql`${t.singleton}`),
    check(
      "seller_country_format",
      sql`length(${t.country}) = 2 and ${t.country} not glob '*[^A-Z]*'`,
    ),
    check(
      "seller_currency_format",
      sql`length(${t.currency}) = 3 and ${t.currency} not glob '*[^A-Z]*'`,
    ),
    check(
      "seller_buyer_turns_range",
      sql`${t.buyerTurnsPer10Min} between 1 and 100`,
    ),
    check(
      "seller_daily_turns_range",
      sql`${t.sellerDailyAiTurns} between 1 and 100000`,
    ),
    check(
      "seller_quote_ttl_range",
      sql`${t.quoteTtlMinutes} between 5 and 1440`,
    ),
    check("seller_hold_ttl_range", sql`${t.holdTtlMinutes} between 5 and 120`),
    check(
      "seller_theme_known",
      sql`${t.theme} in ('slate', 'spruce', 'brick', 'ink', 'plum')`,
    ),
  ],
);

/** Digital asset records in the D1 dialect. */
export const digitalAsset = sqliteTable(
  "digital_asset",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("digital_asset", t),
    check(
      "digital_asset_size_range",
      sql`${t.sizeBytes} between 1 and 1048576`,
    ),
    check(
      "digital_asset_bytes_match",
      sql`length(${t.bytes}) = ${t.sizeBytes}`,
    ),
  ],
);
