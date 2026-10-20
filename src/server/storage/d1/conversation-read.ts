import {
  conversationText,
  type BuyerReplyState,
} from "@/lib/conversation-messages";
import {
  conversation,
  message,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import type { UIMessage } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { ownerScope } from "./guards";

/** Browser-safe ownership projection; it never grants write permission. */
export function conversationControl(row: typeof conversation.$inferSelect) {
  return { id: row.id, handler: row.handler, revision: row.controlRevision };
}
/** Preserves the existing forty-message rendering window; storage remains append-only. */
export function conversationMessages(
  rows: (typeof message.$inferSelect)[],
): UIMessage[] {
  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      role: row.role,
      parts: row.parts as UIMessage["parts"],
    }));
}

/** Coherent native D1 snapshots of control, history and pending seller questions. */
export function createD1ConversationReads(db: D1Db) {
  return {
    async readBuyerConversation(buyer: BuyerPrincipal, id: string) {
      const [rows, history] = await db.batch([
        db
          .select()
          .from(conversation)
          .where(
            and(
              eq(conversation.id, id),
              eq(conversation.sellerId, buyer.sellerId),
              eq(conversation.buyerSessionId, buyer.buyerSessionId),
            ),
          ),
        db
          .select()
          .from(message)
          .where(
            and(
              eq(message.conversationId, id),
              sql`exists(select 1 from conversation where id=${id} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId})`,
            ),
          )
          .orderBy(desc(message.sequence))
          .limit(40),
      ]);
      const row = rows[0];
      if (!row) throw notFound("conversation");
      const messages = conversationMessages(history);
      const active = Boolean(
        row.activeTurnId &&
          row.activeTurnExpiresAt &&
          row.activeTurnExpiresAt > new Date(),
      );
      const replyState: BuyerReplyState =
        row.handler !== "assistant"
          ? "idle"
          : active
            ? "answering"
            : messages.at(-1)?.role === "user"
              ? "interrupted"
              : "idle";
      return { control: conversationControl(row), messages, replyState };
    },
    async readSellerConversation(owner: OwnerPrincipal, id: string) {
      const scope = sql`exists(select 1 from conversation where id=${id} and seller_id=${owner.sellerId}) and ${ownerScope(owner)}`;
      const [rows, history, questions] = await db.batch([
        db
          .select()
          .from(conversation)
          .where(
            and(
              eq(conversation.id, id),
              eq(conversation.sellerId, owner.sellerId),
              ownerScope(owner),
            ),
          ),
        db
          .select()
          .from(message)
          .where(and(eq(message.conversationId, id), scope))
          .orderBy(desc(message.sequence))
          .limit(40),
        db
          .select({
            id: sellerQuestion.id,
            revision: sellerQuestion.revision,
            question: sellerQuestion.question,
          })
          .from(sellerQuestion)
          .where(
            and(
              eq(sellerQuestion.conversationId, id),
              eq(sellerQuestion.sellerId, owner.sellerId),
              eq(sellerQuestion.state, "open"),
              scope,
            ),
          ),
      ]);
      if (!rows[0]) throw notFound("conversation");
      return {
        control: conversationControl(rows[0]),
        messages: conversationMessages(history),
        pending: questions[0] ?? null,
      };
    },
    async readOwnerConversationControl(owner: OwnerPrincipal, id: string) {
      const [row] = await db
        .select()
        .from(conversation)
        .where(
          and(
            eq(conversation.id, id),
            eq(conversation.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!row) throw notFound("conversation");
      return conversationControl(row);
    },
    async readBuyerConversationControl(buyer: BuyerPrincipal, id: string) {
      const [row] = await db
        .select()
        .from(conversation)
        .where(
          and(
            eq(conversation.id, id),
            eq(conversation.sellerId, buyer.sellerId),
            eq(conversation.buyerSessionId, buyer.buyerSessionId),
          ),
        );
      if (!row) throw notFound("conversation");
      return conversationControl(row);
    },
    async listSellerConversations(owner: OwnerPrincipal) {
      const rows = await db
        .select({
          row: conversation,
          parts: sql<string>`(select parts from message where conversation_id=conversation.id order by sequence desc limit 1)`,
        })
        .from(conversation)
        .where(
          and(
            eq(conversation.sellerId, owner.sellerId),
            ownerScope(owner),
            sql`exists(select 1 from message where conversation_id=${conversation.id})`,
          ),
        )
        .orderBy(desc(conversation.updatedAt))
        .limit(50);
      return rows.map(({ row, parts }) => ({
        ...conversationControl(row),
        updatedAt: row.updatedAt.toISOString(),
        preview: conversationText({
          id: row.id,
          role: "assistant",
          parts: JSON.parse(parts) as UIMessage["parts"],
        }).slice(0, 180),
      }));
    },
  };
}
