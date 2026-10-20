import { getStorage } from "@/server/storage";
/**
 * Buyer chat history lives on the server. The browser sends only the new
 * message; earlier turns, including tool results, are loaded from PostgreSQL,
 * so a client cannot rewrite what the assistant was told before.
 */
import { getDb, type Queryable } from "@/server/db/client";
import { conversation, message } from "@/server/db/schema";
import type { StoredMessagePart } from "@/server/db/types";
import type { BuyerPrincipal } from "@/server/domain/principal";
import type { UIMessage } from "ai";
import { desc, eq } from "drizzle-orm";

const MAX_HISTORY = 40;

/** Finds or creates the conversation for an authenticated buyer capability. */
export async function ensureConversation(
  buyer: BuyerPrincipal,
): Promise<string> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.ensureConversation(buyer);

  const db = getDb();
  await db
    .insert(conversation)
    .values({ sellerId: buyer.sellerId, buyerSessionId: buyer.buyerSessionId })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(eq(conversation.buyerSessionId, buyer.buyerSessionId));
  if (!row) throw new Error("conversation missing after insert");
  return row.id;
}

/** Loads the newest complete messages in insertion order, including tied timestamps. */
export async function loadMessages(
  conversationId: string,
  db?: Queryable,
): Promise<UIMessage[]> {
  const backend = getStorage();
  if (!db && backend.kind === "d1")
    return backend.conversations.loadMessages(conversationId);
  db ??= getDb();

  const rows = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.sequence))
    .limit(MAX_HISTORY);
  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      role: row.role,
      parts: row.parts as UIMessage["parts"],
    }));
}

/** Saves messages that are not stored yet (by id). Parts are kept as the UI stream produced them. */
export async function saveMessages(
  conversationId: string,
  messages: UIMessage[],
  db?: Queryable,
): Promise<void> {
  const backend = getStorage();
  if (!db && backend.kind === "d1")
    return backend.conversations.saveMessages(conversationId, messages);
  db ??= getDb();

  const rows = messages
    .filter(
      (m): m is UIMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({
      id: m.id.slice(0, 64),
      conversationId,
      role: m.role,
      parts: m.parts as unknown as StoredMessagePart[],
    }));
  if (rows.length === 0) return;
  await db.insert(message).values(rows).onConflictDoNothing();
  await db
    .update(conversation)
    .set({ updatedAt: new Date() })
    .where(eq(conversation.id, conversationId));
}
