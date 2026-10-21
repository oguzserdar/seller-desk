import type { TurnClaim } from "@/server/ai/turn-control";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  conversation,
  message,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal } from "@/server/domain/principal";
import type { UIMessage } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
} from "./guards";
import { messageWrites } from "./message-writes";

/** A specific answered-question execution, committed with its assistant reply. */
export type ResumeCompletion = {
  id: string;
  resumeAttempts: number;
  resumeClaimId: string | null;
};

/** Native D1 durable buyer history and expiring execution claims. */
export function createD1ConversationStorage(db: D1Db) {
  return {
    async ensureConversation(buyer: BuyerPrincipal): Promise<string> {
      const execution = crypto.randomUUID();
      try {
        const [, , rows] = await db.batch([
          batchGuard(db, `${execution}:scope`, buyerScope(buyer)),
          db
            .insert(conversation)
            .values({
              sellerId: buyer.sellerId,
              buyerSessionId: buyer.buyerSessionId,
            })
            .onConflictDoNothing(),
          db
            .select({ id: conversation.id })
            .from(conversation)
            .where(
              and(
                eq(conversation.buyerSessionId, buyer.buyerSessionId),
                eq(conversation.sellerId, buyer.sellerId),
              ),
            ),
          clearBatchGuards(db, execution),
        ]);
        if (!rows[0]) throw notFound("conversation");
        return rows[0].id;
      } catch (error) {
        if (isBatchGuardFailure(error)) throw notFound("conversation");
        throw error;
      }
    },
    async loadMessages(conversationId: string): Promise<UIMessage[]> {
      const rows = await db
        .select()
        .from(message)
        .where(eq(message.conversationId, conversationId))
        .orderBy(desc(message.sequence))
        .limit(40);
      return rows
        .reverse()
        .map((row) => ({
          id: row.id,
          role: row.role,
          parts: row.parts as UIMessage["parts"],
        }));
    },
    async saveMessages(
      conversationId: string,
      messages: UIMessage[],
    ): Promise<void> {
      const writes = messageWrites(db, conversationId, messages);
      if (!writes.length) return;
      await db.batch([
        db
          .update(conversation)
          .set({ updatedAt: new Date() })
          .where(eq(conversation.id, conversationId)),
        ...writes,
      ]);
    },
    async claimTurn(
      buyer: BuyerPrincipal,
      conversationId: string,
    ): Promise<TurnClaim | undefined> {
      const id = crypto.randomUUID();
      const rows = await db
        .update(conversation)
        .set({
          activeTurnId: id,
          activeTurnExpiresAt: sql`${nowMilliseconds}+120000`,
        })
        .where(
          and(
            eq(conversation.id, conversationId),
            eq(conversation.sellerId, buyer.sellerId),
            eq(conversation.buyerSessionId, buyer.buyerSessionId),
            eq(conversation.handler, "assistant"),
            sql`(${conversation.activeTurnId} is null or ${conversation.activeTurnExpiresAt}<=${nowMilliseconds})`,
            buyerScope(buyer),
          ),
        )
        .returning({ id: conversation.id });
      return rows.length ? { conversationId, id } : undefined;
    },
    async stopTurn(buyer: BuyerPrincipal, conversationId: string): Promise<void> {
      await db
        .update(conversation)
        .set({ activeTurnId: null, activeTurnExpiresAt: null })
        .where(
          and(
            eq(conversation.id, conversationId),
            eq(conversation.sellerId, buyer.sellerId),
            eq(conversation.buyerSessionId, buyer.buyerSessionId),
            eq(conversation.handler, "assistant"),
            buyerScope(buyer),
          ),
        );
    },
    async releaseTurn(claim: TurnClaim): Promise<void> {
      await db
        .update(conversation)
        .set({ activeTurnId: null, activeTurnExpiresAt: null })
        .where(
          and(
            eq(conversation.id, claim.conversationId),
            eq(conversation.activeTurnId, claim.id),
          ),
        );
    },
    async completeTurn(
      claim: TurnClaim,
      messages: UIMessage[],
      resume?: ResumeCompletion,
    ): Promise<void> {
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:claim`,
            sql`exists(select 1 from conversation where id=${claim.conversationId} and handler='assistant' and active_turn_id=${claim.id} and active_turn_expires_at>${nowMilliseconds})
            and ${resume ? sql`exists(select 1 from seller_question where id=${resume.id} and conversation_id=${claim.conversationId} and resume_claim_id=${resume.resumeClaimId} and state='answered' and resume_attempts=${resume.resumeAttempts} and resumed_at>=${nowMilliseconds}-120000)` : sql`1`}`,
          ),
          db
            .update(conversation)
            .set({
              activeTurnId: null,
              activeTurnExpiresAt: null,
              updatedAt: new Date(),
            })
            .where(eq(conversation.id, claim.conversationId)),
          ...(resume
            ? [
                db
                  .update(sellerQuestion)
                  .set({ state: "resumed", resumeError: null })
                  .where(eq(sellerQuestion.id, resume.id)),
              ]
            : []),
          ...messageWrites(db, claim.conversationId, messages),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw new Error("This conversation turn expired or was replaced.");
        throw error;
      }
    },
  };
}
