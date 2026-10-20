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
import type { StoredMessagePart } from "../types";
import { user } from "./auth-schema";
import {
  createdAt,
  inList,
  scalarChecks,
  ts,
  uuid,
  uuidDefault,
} from "./columns";
import { seller } from "./shop";

/** Owner conversation records in the D1 dialect. */
export const ownerConversation = sqliteTable(
  "owner_conversation",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
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
    ...scalarChecks("owner_conversation", t),
    uniqueIndex("owner_conversation_scope_key").on(t.sellerId, t.ownerId),
  ],
);

/** Owner message records in the D1 dialect. */
export const ownerMessage = sqliteTable(
  "owner_message",
  {
    id: text("id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ownerConversation.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: text("parts", { mode: "json" })
      .$type<StoredMessagePart[]>()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("owner_message", t),
    primaryKey({ columns: [t.conversationId, t.id] }),
    index("owner_message_history_idx").on(t.conversationId, t.sequence),
    check("owner_message_role_valid", inList("role", ["user", "assistant"])),
    check("owner_message_id_length", sql`length(${t.id}) between 1 and 64`),
  ],
);
