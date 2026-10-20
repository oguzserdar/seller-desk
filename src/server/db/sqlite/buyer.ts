import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { StoredMessagePart } from "../types";
import {
  createdAt,
  inList,
  nowMilliseconds,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { seller } from "./shop";

/** Buyer session records in the D1 dialect. */
export const buyerSession = sqliteTable(
  "buyer_session",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    entry: text("entry", { enum: ["page", "widget"] }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastSeenAt: ts("last_seen_at").default(nowMilliseconds).notNull(),
  },
  (t) => [
    ...scalarChecks("buyer_session", t),
    check("buyer_session_entry_valid", inList("entry", ["page", "widget"])),
  ],
);

/** Buyer capability records in the D1 dialect. */
export const buyerCapability = sqliteTable(
  "buyer_capability",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    capabilityHash: text("capability_hash").notNull(),
    issuedVia: text("issued_via", { enum: ["start", "handoff"] }).notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    ...scalarChecks("buyer_capability", t),
    uniqueIndex("buyer_capability_hash_key").on(t.capabilityHash),
  ],
);

/** Buyer handoff records in the D1 dialect. */
export const buyerHandoff = sqliteTable(
  "buyer_handoff",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    buyerSessionId: uuid("buyer_session_id")
      .notNull()
      .references(() => buyerSession.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    quoteId: uuid("quote_id"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [
    ...scalarChecks("buyer_handoff", t),
    uniqueIndex("buyer_handoff_code_key").on(t.codeHash),
  ],
);

/** Conversation records in the D1 dialect. */
export const conversation = sqliteTable(
  "conversation",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
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
    ...scalarChecks("conversation", t),
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

/** Message records in the D1 dialect. */
export const message = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    sequence: integer("sequence").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: text("parts", { mode: "json" })
      .$type<StoredMessagePart[]>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("message", t),
    index("message_conversation_idx").on(t.conversationId, t.sequence),
    check("message_role_valid", inList("role", ["user", "assistant"])),
    check("message_id_length", sql`length(${t.id}) between 1 and 64`),
  ],
);
