import { conversationText, sellerReplyOf } from "@/lib/conversation-messages";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  conversation,
  message,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import {
  BuyerMessage,
  SellerMessage,
} from "@/server/domain/conversation-messages";
import { conflict, DomainError, notFound } from "@/server/domain/errors";
import type {
  AssistantTurn,
  BuyerPrincipal,
  OwnerPrincipal,
} from "@/server/domain/principal";
import type { UIMessage } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { D1Db } from "./client";
import {
  conversationControl,
  createD1ConversationReads,
} from "./conversation-read";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { messageWrites } from "./message-writes";

/** Native receipt and delivery of customer messages and explicit seller replies. */
export function createD1ConversationMessages(db: D1Db) {
  return {
    async receiveBuyerMessage(
      buyer: BuyerPrincipal,
      id: string,
      raw: z.input<typeof BuyerMessage>,
      assistantReady: boolean,
    ) {
      const input = BuyerMessage.parse(raw);
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
      if (row.handler === "assistant") {
        if (!assistantReady)
          throw new DomainError(
            "unavailable",
            "The shop assistant is not connected right now. You can still browse and add items to your quote.",
            ["browse"],
          );
        if (
          row.activeTurnId &&
          row.activeTurnExpiresAt &&
          row.activeTurnExpiresAt > new Date()
        )
          throw conflict(
            "The assistant is still answering this conversation. Wait for it to finish.",
          );
      }
      const [prior] = await db
        .select()
        .from(message)
        .where(eq(message.id, input.id));
      if (
        prior &&
        (prior.conversationId !== id ||
          prior.role !== "user" ||
          conversationText({
            id: prior.id,
            role: prior.role,
            parts: prior.parts as UIMessage["parts"],
          }) !== input.text ||
          sellerReplyOf({
            id: prior.id,
            role: prior.role,
            parts: prior.parts as UIMessage["parts"],
          }))
      )
        throw conflict(
          "That message id is already in use. Reload the conversation before retrying.",
        );
      const [latest] = await db
        .select()
        .from(message)
        .where(eq(message.conversationId, id))
        .orderBy(desc(message.sequence))
        .limit(1);
      let claim: AssistantTurn | null = null;
      if (row.handler === "assistant") {
        if (prior) {
          const [lastUser] = await db
            .select({ id: message.id })
            .from(message)
            .where(
              and(eq(message.conversationId, id), eq(message.role, "user")),
            )
            .orderBy(desc(message.sequence))
            .limit(1);
          if (lastUser?.id !== input.id)
            throw conflict(
              "A newer message is already saved. Continue from the latest message.",
            );
        }
        if (!prior || latest?.role === "user")
          claim = { conversationId: id, id: crypto.randomUUID() };
      }
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:receive`,
            sql`${buyerScope(buyer)} and exists(select 1 from conversation where id=${id} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId} and control_revision=${row.controlRevision} and handler=${row.handler}
            and ${row.handler === "assistant" ? sql`(active_turn_id is null or active_turn_expires_at<=${nowMilliseconds})` : sql`1`})
            and coalesce((select max(sequence) from message where conversation_id=${id}),0)=${latest?.sequence ?? 0}
            and ${prior ? sql`exists(select 1 from message where id=${prior.id} and conversation_id=${id} and role='user' and parts=${JSON.stringify(prior.parts)})` : sql`not exists(select 1 from message where id=${input.id})`}`,
          ),
          ...(!prior
            ? messageWrites(db, id, [
                {
                  id: input.id,
                  role: "user",
                  parts: [{ type: "text", text: input.text }],
                },
              ])
            : []),
          db
            .update(conversation)
            .set({
              updatedAt: new Date(),
              ...(claim
                ? {
                    activeTurnId: claim.id,
                    activeTurnExpiresAt: sql`${nowMilliseconds}+120000`,
                  }
                : {}),
            })
            .where(eq(conversation.id, id)),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This conversation changed. Refresh it before continuing.",
          );
        throw error;
      }
      return { control: conversationControl(row), claim };
    },
    async sendSellerMessage(
      owner: OwnerPrincipal,
      raw: z.input<typeof SellerMessage>,
    ) {
      const input = SellerMessage.parse(raw),
        id = input.conversationId;
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
      const [prior] = await db
        .select()
        .from(message)
        .where(and(eq(message.id, input.id), eq(message.conversationId, id)));
      if (prior) {
        const saved = sellerReplyOf({
          id: prior.id,
          role: prior.role,
          parts: prior.parts as UIMessage["parts"],
        });
        if (
          !saved ||
          saved.text !== input.text ||
          saved.answerPending?.id !== input.answerPending?.id ||
          saved.answerPending?.revision !== input.answerPending?.revision
        )
          throw conflict(
            "This reply was already sent with different words or a different request selection. Review the conversation before sending again.",
          );
        return createD1ConversationReads(db).readSellerConversation(owner, id);
      }
      if (
        row.handler !== "seller" ||
        row.controlRevision !== input.expectedRevision
      )
        throw conflict(
          "Conversation control changed. Take over before replying.",
        );
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:reply`,
            sql`${ownerScope(owner)} and exists(select 1 from conversation where id=${id} and seller_id=${owner.sellerId} and handler='seller' and control_revision=${input.expectedRevision})
            and not exists(select 1 from message where id=${input.id})
            and ${input.answerPending ? sql`exists(select 1 from seller_question where id=${input.answerPending.id} and revision=${input.answerPending.revision} and state='open' and conversation_id=${id} and seller_id=${owner.sellerId})` : sql`1`}`,
          ),
          ...(input.answerPending
            ? [
                db
                  .update(sellerQuestion)
                  .set({
                    state: "closed",
                    answer: input.text,
                    answeredAt: new Date(),
                    revision: sql`${sellerQuestion.revision}+1`,
                    resumeClaimId: null,
                    resumeError: null,
                  })
                  .where(eq(sellerQuestion.id, input.answerPending.id)),
              ]
            : []),
          ...messageWrites(db, id, [
            {
              id: input.id,
              role: "assistant",
              parts: [
                {
                  type: "data-seller-reply",
                  data: {
                    text: input.text,
                    sentAt: new Date().toISOString(),
                    ...(input.answerPending
                      ? { answerPending: input.answerPending }
                      : {}),
                  },
                },
              ],
            },
          ]),
          db
            .update(conversation)
            .set({ updatedAt: new Date() })
            .where(eq(conversation.id, id)),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "conversation.reply",
              targetType: "conversation",
              targetId: id,
              outcome: "ok",
              details: {
                messageId: input.id,
                answeredQuestionId: input.answerPending?.id ?? null,
              },
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "Conversation control or the pending request changed. Review it before sending again.",
          );
        throw error;
      }
      return createD1ConversationReads(db).readSellerConversation(owner, id);
    },
  };
}
