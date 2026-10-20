import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ENVIRONMENTS, PAYMENT_STATES } from "../constants";
import type { OrderSnapshot, PaymentEvidence } from "../types";
import { buyerSession } from "./buyer";
import {
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { quote } from "./quotes";
import { seller } from "./shop";

/** Payment attempt records in the D1 dialect. */
export const paymentAttempt = sqliteTable(
  "payment_attempt",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    state: text("state", { enum: PAYMENT_STATES }).notNull(),
    createRequestId: uuid("create_request_id").notNull(),
    createRequestHash: text("create_request_hash").notNull(),
    captureRequestId: uuid("capture_request_id").notNull(),
    captureRequestHash: text("capture_request_hash"),
    providerOrderId: text("provider_order_id"),
    providerCaptureId: text("provider_capture_id"),
    approvalUrl: text("approval_url"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    payeeMerchantId: text("payee_merchant_id"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: ts("lease_expires_at"),
    fence: integer("fence").default(0).notNull(),
    uncertainSince: ts("uncertain_since"),
    nextCheckAt: ts("next_check_at"),
    checkCount: integer("check_count").default(0).notNull(),
    lastProviderStatus: text("last_provider_status"),
    lastError: text("last_error"),
    evidence: text("evidence", { mode: "json" }).$type<PaymentEvidence>(),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("payment_attempt", t),
    uniqueIndex("payment_attempt_quote_key").on(t.quoteId),
    uniqueIndex("payment_attempt_create_request_key").on(t.createRequestId),
    uniqueIndex("payment_attempt_capture_request_key").on(t.captureRequestId),
    uniqueIndex("payment_attempt_provider_order_key")
      .on(t.environment, t.providerOrderId)
      .where(sql`${t.providerOrderId} is not null`),
    uniqueIndex("payment_attempt_provider_capture_key")
      .on(t.environment, t.providerCaptureId)
      .where(sql`${t.providerCaptureId} is not null`),
    index("payment_attempt_due_idx").on(t.state, t.nextCheckAt),
    check("payment_attempt_state_valid", inList("state", PAYMENT_STATES)),
    check(
      "payment_attempt_environment_valid",
      inList("environment", ENVIRONMENTS),
    ),
    check("payment_attempt_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "payment_attempt_paid_has_capture",
      sql`${t.state} <> 'paid' or ${t.providerCaptureId} is not null`,
    ),
  ],
);

/** Orders records in the D1 dialect. */
export const orders = sqliteTable(
  "orders",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    number: integer("number").notNull(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    paymentAttemptId: uuid("payment_attempt_id")
      .notNull()
      .references(() => paymentAttempt.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "restrict" }),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    providerCaptureId: text("provider_capture_id").notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<OrderSnapshot>()
      .notNull(),
    totalMinor: integer("total_minor").notNull(),
    currency: text("currency").notNull(),
    buyerName: text("buyer_name"),
    buyerEmail: text("buyer_email"),
    paidAt: ts("paid_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("orders", t),
    uniqueIndex("orders_number_key").on(t.number),
    uniqueIndex("orders_payment_attempt_key").on(t.paymentAttemptId),
    uniqueIndex("orders_quote_key").on(t.quoteId),
    uniqueIndex("orders_provider_capture_key").on(
      t.environment,
      t.providerCaptureId,
    ),
    index("orders_paid_at_idx").on(t.paidAt),
    check("orders_environment_valid", inList("environment", ENVIRONMENTS)),
    check("orders_total_positive", sql`${t.totalMinor} > 0`),
  ],
);
