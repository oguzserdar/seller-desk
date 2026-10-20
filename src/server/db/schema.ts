/**
 * Seller Desk record schema.
 *
 * Money is integer minor units. Timestamps are timestamptz (UTC). Every status
 * column has a check constraint, and the invariants that protect money live in
 * the database as unique or check constraints, so a bug in application code
 * cannot create a second order, a second capture or an oversold item.
 */
import type { ProcedureContent } from "@/lib/assistant-procedure";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import {
  ENVIRONMENTS,
  OFFER_KINDS,
  PAYMENT_STATES,
  QUOTE_STATUSES,
  RESERVATION_STATES,
  SELLER_QUESTION_STATES,
  TASK_STATES,
  TASK_TYPES,
} from "./constants";
import type {
  AuditDetails,
  DraftOffer,
  OrderSnapshot,
  PaymentEvidence,
  PolicySnapshot,
  ProposalArgs,
  ProposalResult,
  QuoteCharge,
  QuoteLine,
  StoredMessagePart,
  TaskDetails,
  Unresolved,
  WebhookSummary,
} from "./types";

export * from "./auth-schema";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").defaultNow().notNull();
const updatedAt = () =>
  ts("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export {
  ENVIRONMENTS,
  OFFER_KINDS,
  PAYMENT_STATES,
  QUOTE_STATUSES,
  RESERVATION_STATES,
  SELLER_QUESTION_STATES,
  TASK_STATES,
  TASK_TYPES,
} from "./constants";

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

/**
 * Which environment this database belongs to. Written once by migration setup;
 * the app refuses to run when APP_MODE disagrees, so fixture and sandbox data
 * never share a database.
 */
export const installation = pgTable(
  "installation",
  {
    singleton: boolean("singleton").default(true).primaryKey(),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    /** The last real request sent to the configured model from Setup, as provider:model. */
    aiCheckModel: text("ai_check_model"),
    aiCheckOk: boolean("ai_check_ok"),
    aiCheckDetail: text("ai_check_detail"),
    aiCheckedAt: ts("ai_checked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("installation_singleton_true", sql`${t.singleton}`),
    check(
      "installation_environment_valid",
      inList("environment", ENVIRONMENTS),
    ),
  ],
);

/** One seller per installation, owned by one Better Auth user. */
export const seller = pgTable(
  "seller",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    allowedOrigins: text("allowed_origins")
      .array()
      .default(sql`'{}'::text[]`)
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
    uniqueIndex("seller_singleton_key").on(t.singleton),
    uniqueIndex("seller_owner_key").on(t.ownerUserId),
    check("seller_singleton_true", sql`${t.singleton}`),
    check("seller_country_format", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check("seller_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
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

/** Private sample bytes for digital offers (1 MiB limit, never served from public/). */
export const digitalAsset = pgTable(
  "digital_asset",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    check(
      "digital_asset_size_range",
      sql`${t.sizeBytes} between 1 and 1048576`,
    ),
    check(
      "digital_asset_bytes_match",
      sql`octet_length(${t.bytes}) = ${t.sizeBytes}`,
    ),
  ],
);

/** A seller-approved offer. Every edit bumps `revision`; quotes snapshot it. */
export const offer = pgTable(
  "offer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    index("offer_seller_published_idx").on(t.sellerId, t.published),
    check(
      "offer_image_path_local",
      sql`${t.imagePath} is null or ${t.imagePath} ~ '^/shop/[a-z0-9-]{1,60}\\.(webp|png|jpg)$'`,
    ),
    check("offer_kind_valid", inList("kind", OFFER_KINDS)),
    check(
      "offer_price_range",
      sql`(${t.unitAmountMinor} is not null and ${t.unitAmountMinor} between 1 and 10000000) or (${t.unitAmountMinor} is null and ${t.kind} = 'service' and ${t.requiresScopeReview})`,
    ),
    check("offer_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("offer_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check(
      "offer_description_length",
      sql`char_length(${t.description}) between 1 and 2000`,
    ),
    check("offer_max_quantity_range", sql`${t.maxQuantity} between 1 and 100`),
    check("offer_revision_positive", sql`${t.revision} >= 1`),
    check(
      "offer_digital_needs_asset",
      sql`${t.kind} <> 'digital' or not ${t.published} or (${t.digitalAssetId} is not null and ${t.accessDays} between 1 and 3650)`,
    ),
    check(
      "offer_service_needs_scope",
      sql`${t.kind} <> 'service' or not ${t.published} or char_length(coalesce(${t.serviceScope}, '')) > 0`,
    ),
  ],
);

/** Finite stock for goods. A guarded UPDATE keeps `held + sold <= total`. */
export const inventory = pgTable(
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
    check(
      "inventory_non_negative",
      sql`${t.total} >= 0 and ${t.held} >= 0 and ${t.sold} >= 0`,
    ),
    check("inventory_not_oversold", sql`${t.held} + ${t.sold} <= ${t.total}`),
  ],
);

/** Assisted setup draft from pasted text or CSV. Never public before the owner publishes. */
export const importDraft = pgTable(
  "import_draft",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", { enum: ["paste", "csv"] }).notNull(),
    sourceText: text("source_text").notNull(),
    sourceHash: text("source_hash").notNull(),
    status: text("status", { enum: ["draft", "published", "discarded"] })
      .default("draft")
      .notNull(),
    proposed: jsonb("proposed").$type<DraftOffer[]>().notNull(),
    reviewRevision: integer("review_revision").default(1).notNull(),
    generator: text("generator").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "import_draft_source_length",
      sql`char_length(${t.sourceText}) between 1 and 20000`,
    ),
    check(
      "import_draft_status_valid",
      inList("status", ["draft", "published", "discarded"]),
    ),
    check("import_draft_kind_valid", inList("source_kind", ["paste", "csv"])),
  ],
);

/** A buyer conversation scope. Holds no owner authority. */
export const buyerSession = pgTable(
  "buyer_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    entry: text("entry", { enum: ["page", "widget"] }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    check("buyer_session_entry_valid", inList("entry", ["page", "widget"])),
  ],
);

/** Random bearer capability for a buyer session; only its SHA-256 is stored. */
export const buyerCapability = pgTable(
  "buyer_capability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    capabilityHash: text("capability_hash").notNull(),
    issuedVia: text("issued_via", { enum: ["start", "handoff"] }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("buyer_capability_hash_key").on(t.capabilityHash)],
);

/** One-time code that moves a buyer scope from the widget iframe to the top-level page. */
export const buyerHandoff = pgTable(
  "buyer_handoff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    quoteId: uuid("quote_id"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [uniqueIndex("buyer_handoff_code_key").on(t.codeHash)],
);

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    activeTurnId: uuid("active_turn_id"),
    activeTurnExpiresAt: ts("active_turn_expires_at"),
    handler: text("handler", { enum: ["assistant", "seller"] })
      .default("assistant")
      .notNull(),
    controlRevision: integer("control_revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conversation_buyer_session_key").on(t.buyerSessionId),
    check(
      "conversation_handler_valid",
      inList("handler", ["assistant", "seller"]),
    ),
    check(
      "conversation_control_revision_positive",
      sql`${t.controlRevision} > 0`,
    ),
  ],
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    sequence: integer("sequence").generatedAlwaysAsIdentity().notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<StoredMessagePart[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("message_conversation_idx").on(t.conversationId, t.sequence),
    check("message_role_valid", inList("role", ["user", "assistant"])),
    check("message_id_length", sql`char_length(${t.id}) between 1 and 64`),
  ],
);

/** Private assistant conversation for one authenticated owner of one shop. */
export const ownerConversation = pgTable(
  "owner_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeTurnId: uuid("active_turn_id"),
    activeTurnExpiresAt: ts("active_turn_expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("owner_conversation_scope_key").on(t.sellerId, t.ownerId),
  ],
);

/** Append-only owner chat messages; ids are unique within their conversation. */
export const ownerMessage = pgTable(
  "owner_message",
  {
    id: text("id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ownerConversation.id, { onDelete: "cascade" }),
    sequence: integer("sequence").generatedAlwaysAsIdentity().notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: jsonb("parts").$type<StoredMessagePart[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.id] }),
    index("owner_message_history_idx").on(t.conversationId, t.sequence),
    check("owner_message_role_valid", inList("role", ["user", "assistant"])),
    check(
      "owner_message_id_length",
      sql`char_length(${t.id}) between 1 and 64`,
    ),
  ],
);

/**
 * A server-priced quote revision. Commercial content is immutable once written;
 * a change creates the next revision in the same thread and marks this one replaced.
 */
export const quote = pgTable(
  "quote",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull(),
    revision: integer("revision").notNull(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    status: text("status", { enum: QUOTE_STATUSES }).notNull(),
    lines: jsonb("lines").$type<QuoteLine[]>().notNull(),
    charges: jsonb("charges").$type<QuoteCharge[]>().notNull(),
    unresolved: jsonb("unresolved").$type<Unresolved[]>().default([]).notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<PolicySnapshot>().notNull(),
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
      sql`char_length(coalesce(${t.buyerNote}, '')) <= 1000`,
    ),
  ],
);

/** Private delivery terms frozen with a quote revision, unaffected by later catalog edits. */
export const digitalQuoteLine = pgTable(
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
    primaryKey({ columns: [t.quoteId, t.offerId] }),
    check(
      "digital_quote_line_access_days_valid",
      sql`${t.accessDays} between 1 and 3650`,
    ),
  ],
);

/** Stock held for an accepted goods quote while PayPal approval happens. */
export const reservation = pgTable(
  "reservation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    uniqueIndex("reservation_quote_offer_key").on(t.quoteId, t.offerId),
    index("reservation_state_expiry_idx").on(t.state, t.expiresAt),
    check("reservation_quantity_positive", sql`${t.quantity} > 0`),
    check("reservation_state_valid", inList("state", RESERVATION_STATES)),
  ],
);

/**
 * The durable record of one PayPal payment for one accepted quote revision.
 * Request IDs and hashes are written before any network call, so a retry
 * repeats the same operation instead of creating a new charge.
 */
export const paymentAttempt = pgTable(
  "payment_attempt",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    evidence: jsonb("evidence").$type<PaymentEvidence>(),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
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

/** A verified paid order. One per verified payment attempt and per provider capture. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    number: integer("number")
      .generatedAlwaysAsIdentity({ startWith: 1001 })
      .notNull(),
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
    snapshot: jsonb("snapshot").$type<OrderSnapshot>().notNull(),
    totalMinor: integer("total_minor").notNull(),
    currency: text("currency").notNull(),
    buyerName: text("buyer_name"),
    buyerEmail: text("buyer_email"),
    paidAt: ts("paid_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
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

/** Work owed after payment. Paid is never the same as picked up, booked or delivered. */
export const fulfillmentTask = pgTable(
  "fulfillment_task",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type", { enum: TASK_TYPES }).notNull(),
    state: text("state", { enum: TASK_STATES }).notNull(),
    revision: integer("revision").default(1).notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    lastError: text("last_error"),
    details: jsonb("details").$type<TaskDetails>().default({}).notNull(),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fulfillment_task_order_type_key").on(t.orderId, t.type),
    index("fulfillment_task_state_idx").on(t.state),
    check("fulfillment_task_type_valid", inList("type", TASK_TYPES)),
    check("fulfillment_task_state_valid", inList("state", TASK_STATES)),
  ],
);

/** Paid access to a private digital asset. One grant per order and asset. */
export const accessGrant = pgTable(
  "access_grant",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => digitalAsset.id, { onDelete: "restrict" }),
    capabilityHash: text("capability_hash").notNull(),
    state: text("state", { enum: ["active", "revoked"] }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    downloadCount: integer("download_count").default(0).notNull(),
    lastDownloadAt: ts("last_download_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("access_grant_order_asset_key").on(t.orderId, t.assetId),
    uniqueIndex("access_grant_capability_key").on(t.capabilityHash),
    check("access_grant_state_valid", inList("state", ["active", "revoked"])),
  ],
);

/** An owner action proposed by the assistant or a button, bound to one exact target revision. */
export const ownerProposal = pgTable(
  "owner_proposal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    verb: text("verb").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    args: jsonb("args").$type<ProposalArgs>().notNull(),
    argsHash: text("args_hash").notNull(),
    summary: text("summary").notNull(),
    state: text("state", {
      enum: ["pending", "executed", "rejected", "expired", "failed"],
    }).notNull(),
    result: jsonb("result").$type<ProposalResult>(),
    expiresAt: ts("expires_at").notNull(),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("owner_proposal_state_idx").on(t.state),
    check(
      "owner_proposal_state_valid",
      inList("state", ["pending", "executed", "rejected", "expired", "failed"]),
    ),
  ],
);

/**
 * A customer's question the agent could not settle without the seller (a time,
 * a commitment, a fact the catalog lacks). The conversation waits on it; the
 * seller's answer resumes that same conversation with a new model turn.
 */
export const sellerQuestion = pgTable(
  "seller_question",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    customerGoal: text("customer_goal").notNull(),
    knownFacts: jsonb("known_facts").$type<string[]>().notNull(),
    state: text("state", { enum: SELLER_QUESTION_STATES })
      .default("open")
      .notNull(),
    answer: text("answer"),
    answeredAt: ts("answered_at"),
    resumedAt: ts("resumed_at"),
    resumeClaimId: uuid("resume_claim_id"),
    resumeAfter: ts("resume_after").defaultNow().notNull(),
    resumeAttempts: integer("resume_attempts").default(0).notNull(),
    resumeError: text("resume_error"),
    reviewClaimId: uuid("review_claim_id"),
    reviewClaimExpiresAt: ts("review_claim_expires_at"),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("seller_question_one_waiting_per_conversation")
      .on(t.conversationId)
      .where(sql`${t.state} in ('open', 'answered')`),
    index("seller_question_seller_state_idx").on(t.sellerId, t.state),
    check(
      "seller_question_state_valid",
      inList("state", SELLER_QUESTION_STATES),
    ),
    check(
      "seller_question_lengths",
      sql`char_length(${t.question}) between 1 and 500 and char_length(${t.customerGoal}) between 1 and 500 and (${t.answer} is null or char_length(${t.answer}) between 1 and 1000)`,
    ),
  ],
);

/** Idempotency record: one accepted operation per (scope, key) and payload hash. */
export const operationKey = pgTable(
  "operation_key",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state", {
      enum: ["in_progress", "completed", "failed"],
    }).notNull(),
    result: jsonb("result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    check(
      "operation_key_state_valid",
      inList("state", ["in_progress", "completed", "failed"]),
    ),
  ],
);

/** Durable inbox for verified PayPal webhook events, deduplicated per environment. */
export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerOrderId: text("provider_order_id"),
    summary: jsonb("summary").$type<WebhookSummary>().notNull(),
    processingState: text("processing_state", {
      enum: ["received", "processed", "failed", "ignored"],
    }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: ts("next_attempt_at").defaultNow().notNull(),
    lastError: text("last_error"),
    receivedAt: ts("received_at").defaultNow().notNull(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("webhook_event_provider_key").on(
      t.environment,
      t.providerEventId,
    ),
    index("webhook_event_due_idx").on(t.processingState, t.nextAttemptAt),
    check(
      "webhook_event_state_valid",
      inList("processing_state", [
        "received",
        "processed",
        "failed",
        "ignored",
      ]),
    ),
  ],
);

/** Durable background work with backoff, run by the authenticated job trigger. */
export const job = pgTable(
  "job",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind", {
      enum: ["reconcile_payment", "grant_access"],
    }).notNull(),
    targetId: uuid("target_id").notNull(),
    state: text("state", { enum: ["pending", "done", "failed"] }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    runAfter: ts("run_after").defaultNow().notNull(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("job_kind_target_key").on(t.kind, t.targetId),
    index("job_due_idx").on(t.state, t.runAfter),
    check(
      "job_kind_valid",
      inList("kind", ["reconcile_payment", "grant_access"]),
    ),
    check("job_state_valid", inList("state", ["pending", "done", "failed"])),
  ],
);

/** Append-only operation history without secrets. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: text("actor", {
      enum: ["owner", "buyer", "system", "paypal", "job", "assistant"],
    }).notNull(),
    actorId: text("actor_id"),
    operation: text("operation").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome", {
      enum: ["ok", "denied", "failed", "noop"],
    }).notNull(),
    details: jsonb("details").$type<AuditDetails>().default({}).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_event_target_idx").on(t.targetId),
    index("audit_event_created_idx").on(t.createdAt),
  ],
);

/** Atomic usage counters for AI spend limits (per buyer, per seller, per client). */
export const usageBucket = pgTable(
  "usage_bucket",
  {
    feature: text("feature").notNull(),
    principal: text("principal").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.feature, t.principal, t.windowStart] })],
);

/**
 * Fixture-mode stand-in for PayPal's own records. Used only when APP_MODE=fixture;
 * it models an external system so restart and lost-response tests are honest.
 */
export const fixtureProviderOrder = pgTable(
  "fixture_provider_order",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    referenceId: text("reference_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    payeeMerchantId: text("payee_merchant_id").notNull(),
    captureId: text("capture_id"),
    captureStatus: text("capture_status"),
    captureRequestId: text("capture_request_id"),
    captureAmountMinor: integer("capture_amount_minor"),
    payerName: text("payer_name"),
    payerEmail: text("payer_email"),
    returnUrl: text("return_url").notNull(),
    cancelUrl: text("cancel_url").notNull(),
    createdAt: createdAt(),
    approvedAt: ts("approved_at"),
    capturedAt: ts("captured_at"),
  },
  (t) => [uniqueIndex("fixture_provider_order_request_key").on(t.requestId)],
);

/** Fixture-only fault injection, set by `pnpm fixture:fault` or test helpers. */
export const fixtureFault = pgTable("fixture_fault", {
  name: text("name").primaryKey(),
  remaining: integer("remaining").notNull(),
  createdAt: createdAt(),
});

/** Public shop knowledge, explicitly published by the owner and revisioned for safe links. */
export const shopGuide = pgTable(
  "shop_guide",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    topic: text("topic", {
      enum: [
        "shipping",
        "returns",
        "options",
        "booking",
        "subscriptions",
        "downloads",
        "general",
      ],
    }).notNull(),
    body: text("body").notNull(),
    actionLabel: text("action_label"),
    actionUrl: text("action_url"),
    published: boolean("published").default(false).notNull(),
    productId: uuid("product_id").references(() => offer.id, {
      onDelete: "restrict",
    }),
    validUntil: ts("valid_until"),
    archived: boolean("archived").default(false).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shop_guide_seller_idx").on(t.sellerId),
    check("shop_guide_revision_positive", sql`${t.revision} > 0`),
    check(
      "shop_guide_archived_unpublished",
      sql`not ${t.archived} or not ${t.published}`,
    ),
    check("shop_guide_title_length", sql`length(${t.title}) between 3 and 100`),
    check("shop_guide_body_length", sql`length(${t.body}) between 10 and 2000`),
    check(
      "shop_guide_topic_valid",
      inList("topic", [
        "shipping",
        "returns",
        "options",
        "booking",
        "subscriptions",
        "downloads",
        "general",
      ]),
    ),
    check(
      "shop_guide_action_pair",
      sql`(${t.actionLabel} is null and ${t.actionUrl} is null) or (${t.actionLabel} is not null and ${t.actionUrl} is not null and length(${t.actionLabel}) between 1 and 60 and length(${t.actionUrl}) between 1 and 1500 and ${t.actionUrl} like 'https://%')`,
    ),
  ],
);

/** Append-only snapshots for owner review and explicit restoration as a new draft. */
export const shopGuideVersion = pgTable(
  "shop_guide_version",
  {
    guideId: uuid("guide_id")
      .notNull()
      .references(() => shopGuide.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot")
      .$type<import("@/lib/shop-guide").GuideSnapshot>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guideId, t.revision] }),
    index("shop_guide_version_seller_idx").on(t.sellerId),
    check("shop_guide_version_positive", sql`${t.revision} > 0`),
  ],
);

/** Private, source-versioned findings. A review never publishes itself into shop knowledge. */
export const learningReview = pgTable(
  "learning_review",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => sellerQuestion.id, { onDelete: "cascade" }),
    sourceHash: text("source_hash").notNull(),
    source: jsonb("source")
      .$type<import("@/lib/learning-review").LearningSource>()
      .notNull(),
    analysis: jsonb("analysis")
      .$type<import("@/lib/learning-review").LearningAnalysis>()
      .notNull(),
    editedDrafts: jsonb("edited_drafts")
      .$type<import("@/lib/learning-draft").LearningDraft[]>()
      .default([])
      .notNull(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["draft", "deferred", "rejected"] })
      .default("draft")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("learning_review_source_unique").on(
      t.sellerId,
      t.questionId,
      t.sourceHash,
    ),
    index("learning_review_seller_state_idx").on(t.sellerId, t.state),
    check(
      "learning_review_state_valid",
      inList("state", ["draft", "deferred", "rejected"]),
    ),
    check("learning_review_revision_positive", sql`${t.revision} > 0`),
    check(
      "learning_review_source_hash_length",
      sql`length(${t.sourceHash}) = 64`,
    ),
  ],
);

/** Immutable owner approval linking a private finding to one public knowledge version. */
export const learningPublication = pgTable(
  "learning_publication",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => learningReview.id, { onDelete: "restrict" }),
    findingIndex: integer("finding_index").notNull(),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => shopGuide.id, { onDelete: "restrict" }),
    guideRevision: integer("guide_revision").notNull(),
    approvedInput: jsonb("approved_input")
      .$type<import("@/lib/learning-publication").PublishLearningInput>()
      .notNull(),
    publicSource: jsonb("public_source")
      .$type<import("@/lib/learning-review").LearningSource["guides"][number]>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("learning_publication_finding_unique").on(
      t.reviewId,
      t.findingIndex,
    ),
    index("learning_publication_seller_idx").on(t.sellerId),
    check(
      "learning_publication_finding_range",
      sql`${t.findingIndex} between 0 and 5`,
    ),
    check(
      "learning_publication_revision_positive",
      sql`${t.guideRevision} > 0`,
    ),
  ],
);

/** Private real-model comparisons retain their exact facts and both successful and failed runs. */
export const learningPreview = pgTable(
  "learning_preview",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => learningReview.id, { onDelete: "restrict" }),
    reviewRevision: integer("review_revision").notNull(),
    findingIndex: integer("finding_index").notNull(),
    question: text("question").notNull(),
    sourceHash: text("source_hash").notNull(),
    draftBody: text("draft_body").notNull(),
    currentFacts: jsonb("current_facts")
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    proposedFacts: jsonb("proposed_facts")
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["running", "completed", "failed"] })
      .default("running")
      .notNull(),
    currentAnswer:
      jsonb("current_answer").$type<
        import("@/lib/learning-preview").PreviewAnswer
      >(),
    proposedAnswer:
      jsonb("proposed_answer").$type<
        import("@/lib/learning-preview").PreviewAnswer
      >(),
    failure: text("failure"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    index("learning_preview_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("learning_preview_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "learning_preview_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check("learning_preview_revision_positive", sql`${t.reviewRevision} > 0`),
    check(
      "learning_preview_finding_range",
      sql`${t.findingIndex} between 0 and 5`,
    ),
    check(
      "learning_preview_question_length",
      sql`length(trim(${t.question})) between 5 and 1000`,
    ),
    check(
      "learning_preview_completed_answers",
      sql`${t.state} <> 'completed' or (${t.currentAnswer} is not null and ${t.proposedAnswer} is not null)`,
    ),
  ],
);

/** Append-only customer problems and seller replies; only the buyer can confirm a problem resolved. */
export const orderFollowup = pgTable(
  "order_followup",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    actor: text("actor", { enum: ["buyer", "owner"] }).notNull(),
    state: text("state", {
      enum: ["needs_help", "awaiting_customer", "confirmed"],
    }).notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.revision] }),
    check("order_followup_revision_positive", sql`${t.revision} > 0`),
    check(
      "order_followup_actor_state",
      sql`(${t.actor} = 'buyer' and ${t.state} in ('needs_help', 'confirmed')) or (${t.actor} = 'owner' and ${t.state} = 'awaiting_customer')`,
    ),
    check(
      "order_followup_message_length",
      sql`(${t.state} = 'confirmed' and ${t.message} = '') or (${t.state} <> 'confirmed' and length(trim(${t.message})) between 3 and 1000)`,
    ),
  ],
);

/** Saved handling instructions; draft edits never change the separately selected live version. */
export const assistantProcedure = pgTable(
  "assistant_procedure",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull().default(1),
    content: jsonb("content").$type<ProcedureContent>().notNull(),
    publishedRevision: integer("published_revision"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("assistant_procedure_seller_idx").on(t.sellerId),
    check("assistant_procedure_revision_positive", sql`${t.revision} > 0`),
    check(
      "assistant_procedure_publication_valid",
      sql`${t.publishedRevision} is null or (${t.publishedRevision} > 0 and ${t.publishedRevision} <= ${t.revision} and not ${t.archived})`,
    ),
  ],
);

/** Every saved wording remains available for a later explicit draft restore. */
export const assistantProcedureVersion = pgTable(
  "assistant_procedure_version",
  {
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => assistantProcedure.id, { onDelete: "restrict" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    content: jsonb("content").$type<ProcedureContent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.procedureId, t.revision] }),
    check("assistant_procedure_version_positive", sql`${t.revision} > 0`),
  ],
);

/** Private reply comparisons freeze both instruction sets and never create a customer purchase. */
export const procedurePreview = pgTable(
  "procedure_preview",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => assistantProcedure.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    publishedRevision: integer("published_revision"),
    question: text("question").notNull(),
    wording: jsonb("wording").$type<ProcedureContent>().notNull(),
    facts: jsonb("facts")
      .$type<import("@/lib/learning-preview").PreviewFacts>()
      .notNull(),
    currentInstructions: jsonb("current_instructions")
      .$type<ProcedureContent[]>()
      .notNull(),
    proposedInstructions: jsonb("proposed_instructions")
      .$type<ProcedureContent[]>()
      .notNull(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["running", "completed", "failed"] })
      .default("running")
      .notNull(),
    currentAnswer:
      jsonb("current_answer").$type<
        import("@/lib/learning-preview").PreviewAnswer
      >(),
    proposedAnswer:
      jsonb("proposed_answer").$type<
        import("@/lib/learning-preview").PreviewAnswer
      >(),
    failure: text("failure"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    index("procedure_preview_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("procedure_preview_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "procedure_preview_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check("procedure_preview_revision_positive", sql`${t.revision} > 0`),
    check(
      "procedure_preview_question_length",
      sql`length(trim(${t.question})) between 5 and 1000`,
    ),
    check(
      "procedure_preview_completed_answers",
      sql`${t.state} <> 'completed' or (${t.currentAnswer} is not null and ${t.proposedAnswer} is not null)`,
    ),
  ],
);

/** Durable private trials retain frozen shop facts and partial results without touching commerce. */
export const simulationRun = pgTable(
  "simulation_run",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    input: jsonb("input")
      .$type<import("@/lib/simulation").SimulationInput>()
      .notNull(),
    snapshot: jsonb("snapshot")
      .$type<import("@/server/simulation/snapshot").SimulationShopSnapshot>()
      .notNull(),
    change:
      jsonb("change").$type<import("@/lib/simulation").SimulationChange>(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    currentResult:
      jsonb("current_result").$type<
        import("@/lib/simulation").SimulationSideResult
      >(),
    proposedResult:
      jsonb("proposed_result").$type<
        import("@/lib/simulation").SimulationSideResult
      >(),
    failure: text("failure"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    index("simulation_run_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("simulation_run_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "simulation_run_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check(
      "simulation_run_ordered_results",
      sql`${t.proposedResult} is null or ${t.currentResult} is not null`,
    ),
    check(
      "simulation_run_completed_results",
      sql`${t.state} <> 'completed' or (${t.currentResult} is not null and (${t.change} is null or ${t.proposedResult} is not null))`,
    ),
  ],
);
