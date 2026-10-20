import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  message,
  ownerMessage,
  storageSequence,
} from "@/server/db/sqlite/schema";
import type { StoredMessagePart } from "@/server/db/types";
import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import type { D1Db } from "./client";

/**
 * Builds two native statements for a whole saved history. The command's guards,
 * counter allocation and messages must run in the same batch. Retries may consume
 * identity numbers, just as PostgreSQL identity does, but cannot duplicate rows.
 */
export function messageWrites(
  db: D1Db,
  conversationId: string,
  messages: UIMessage[],
  owner = false,
) {
  const rows = messages
    .filter(
      (message): message is UIMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      id: message.id.slice(0, 64),
      role: message.role,
      parts: message.parts as StoredMessagePart[],
    }));
  if (!rows.length) return [];
  const name = owner ? "owner_message" : "message";
  const allocate = db
    .insert(storageSequence)
    .values({ name, value: rows.length })
    .onConflictDoUpdate({
      target: storageSequence.name,
      set: { value: sql`${storageSequence.value}+${rows.length}` },
    });
  const id = sql<string>`json_extract(j.value,'$.id')`.as("id"),
    parent = sql<string>`${conversationId}`.as("conversation_id");
  const sequence =
    sql<number>`s.value-${rows.length}+cast(j.key as integer)+1`.as("sequence");
  const role = sql<"user" | "assistant">`json_extract(j.value,'$.role')`.as(
      "role",
    ),
    parts = sql<StoredMessagePart[]>`json_extract(j.value,'$.parts')`.as(
      "parts",
    );
  const source = sql`json_each(${JSON.stringify(rows)}) j join storage_sequence s on s.name=${name}`;
  // Use native prepared insert/select builders. The installed Drizzle D1 batch
  // cannot execute SQLiteRaw objects even though its public types accept them.
  const insert = owner
    ? db
        .insert(ownerMessage)
        .select(
          db
            .select({
              id,
              conversationId: parent,
              sequence,
              role,
              parts,
              createdAt: nowMilliseconds.as("created_at"),
            })
            .from(source)
            .where(sql`true`),
        )
        .onConflictDoNothing()
    : db
        .insert(message)
        .select(
          db
            .select({
              id,
              sequence,
              conversationId: parent,
              role,
              parts,
              createdAt: nowMilliseconds.as("created_at"),
            })
            .from(source)
            .where(sql`true`),
        )
        .onConflictDoNothing();
  return [allocate, insert];
}
