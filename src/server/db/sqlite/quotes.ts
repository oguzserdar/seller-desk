import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { QUOTE_STATUSES, RESERVATION_STATES } from "../constants";
import type {
  PolicySnapshot,
  QuoteCharge,
  QuoteLine,
  Unresolved,
} from "../types";
import { buyerSession } from "./buyer";
import { offer } from "./catalog";
import {
  boolean,
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { digitalAsset, seller } from "./shop";

/** Quote records in the D1 dialect. */
export const quote = sqliteTable(
  "quote",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    threadId: uuid("thread_id").notNull(),
    revision: integer("revision").notNull(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    status: text("status", { enum: QUOTE_STATUSES }).notNull(),
    lines: text("lines", { mode: "json" }).$type<QuoteLine[]>().notNull(),
    charges: text("charges", { mode: "json" }).$type<QuoteCharge[]>().notNull(),
    unresolved: text("unresolved", { mode: "json" })
      .$type<Unresolved[]>()
      .default([])
      .notNull(),
    policySnapshot: text("policy_snapshot", { mode: "json" })
      .$type<PolicySnapshot>()
      .notNull(),
    subtotalMinor: integer("subtotal_minor"),
    totalMinor: integer("total_minor"),
    currency: text("currency").notNull(),
    buyerNote: text("buyer_note"),
    budgetMinor: integer("budget_minor"),
    deliveryRequested: boolean("delivery_requested").default(false).notNull(),
    reviewReason: text("review_reason"),
    approvedScope: text("approved_scope"),
    sellerApprovedAt: ts("seller_approved_at"),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("quote", t),
    uniqueIndex("quote_thread_revision_key").on(t.threadId, t.revision),
    index("quote_buyer_session_idx").on(t.buyerSessionId),
    index("quote_status_idx").on(t.status),
    check("quote_status_valid", inList("status", QUOTE_STATUSES)),
    check(
      "quote_totals_valid",
      sql`(${t.subtotalMinor} is null and ${t.totalMinor} is null) or (${t.subtotalMinor} is not null and ${t.totalMinor} is not null and ${t.subtotalMinor} >= 0 and ${t.totalMinor} >= ${t.subtotalMinor})`,
    ),
    check("quote_total_cap", sql`${t.totalMinor} <= 100000000`),
    check(
      "quote_payable_has_total",
      sql`${t.status} not in ('review_ready', 'accepted', 'consumed') or (${t.totalMinor} is not null and ${t.totalMinor} > 0)`,
    ),
    check(
      "quote_note_length",
      sql`length(coalesce(${t.buyerNote}, '')) <= 1000`,
    ),
  ],
);

/** Digital quote line records in the D1 dialect. */
export const digitalQuoteLine = sqliteTable(
  "digital_quote_line",
  {
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offer.id, { onDelete: "restrict" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => digitalAsset.id, { onDelete: "restrict" }),
    accessDays: integer("access_days").notNull(),
  },
  (t) => [
    ...scalarChecks("digital_quote_line", t),
    primaryKey({ columns: [t.quoteId, t.offerId] }),
    check(
      "digital_quote_line_access_days_valid",
      sql`${t.accessDays} between 1 and 3650`,
    ),
  ],
);

/** Reservation records in the D1 dialect. */
export const reservation = sqliteTable(
  "reservation",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offer.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    state: text("state", { enum: RESERVATION_STATES }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("reservation", t),
    uniqueIndex("reservation_quote_offer_key").on(t.quoteId, t.offerId),
    index("reservation_state_expiry_idx").on(t.state, t.expiresAt),
    check("reservation_quantity_positive", sql`${t.quantity} > 0`),
    check("reservation_state_valid", inList("state", RESERVATION_STATES)),
  ],
);
