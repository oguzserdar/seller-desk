import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  conversation,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import { AssistantTurnEnded } from "@/server/domain/assistant-turn";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import {
  MAX_RESUME_ATTEMPTS,
  type AskInput,
  type SellerQuestionRow,
} from "@/server/domain/seller-questions";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import type { ResumeCompletion } from "./conversation";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

const assistantOwned = sql`exists(select 1 from conversation c where c.id=${sellerQuestion.conversationId} and c.seller_id=${sellerQuestion.sellerId} and c.handler='assistant')`;
const resumable = and(
  assistantOwned,
  eq(sellerQuestion.state, "answered"),
  sql`${sellerQuestion.resumeAfter}<=${nowMilliseconds}`,
  sql`${sellerQuestion.resumeAttempts}<${MAX_RESUME_ATTEMPTS}`,
  sql`(${sellerQuestion.resumedAt} is null or ${sellerQuestion.resumedAt}<${nowMilliseconds}-120000)`,
);
function liveResume(claim: ResumeCompletion) {
  return and(
    eq(sellerQuestion.id, claim.id),
    eq(sellerQuestion.resumeClaimId, claim.resumeClaimId ?? ""),
    eq(sellerQuestion.state, "answered"),
    eq(sellerQuestion.resumeAttempts, claim.resumeAttempts),
  );
}

async function closeExpired(db: D1Db, id?: string): Promise<void> {
  await db
    .update(sellerQuestion)
    .set({
      state: "closed",
      resumedAt: null,
      resumeError:
        "The assistant could not finish after three attempts. The seller's answer is saved; the customer can continue the conversation.",
    })
    .where(
      and(
        assistantOwned,
        id ? eq(sellerQuestion.id, id) : undefined,
        eq(sellerQuestion.state, "answered"),
        sql`${sellerQuestion.resumeAttempts}>=${MAX_RESUME_ATTEMPTS}`,
        sql`(${sellerQuestion.resumedAt} is null or ${sellerQuestion.resumedAt}<${nowMilliseconds}-120000)`,
      ),
    );
}

/** Native seller questions, explicit answers and fenced continuation leases. */
export function createD1SellerQuestions(db: D1Db) {
  const readWaiting = async (buyer: BuyerPrincipal) =>
    (
      await db
        .select()
        .from(sellerQuestion)
        .where(
          and(
            eq(sellerQuestion.buyerSessionId, buyer.buyerSessionId),
            eq(sellerQuestion.sellerId, buyer.sellerId),
            inArray(sellerQuestion.state, ["open", "answered"]),
          ),
        )
    )[0];
  return {
    waitingQuestion: readWaiting,
    async latestQuestion(
      buyer: BuyerPrincipal,
    ): Promise<SellerQuestionRow | undefined> {
      return (
        await db
          .select()
          .from(sellerQuestion)
          .where(
            and(
              eq(sellerQuestion.buyerSessionId, buyer.buyerSessionId),
              eq(sellerQuestion.sellerId, buyer.sellerId),
            ),
          )
          .orderBy(desc(sellerQuestion.createdAt))
          .limit(1)
      )[0];
    },
    async openQuestions(owner: OwnerPrincipal): Promise<SellerQuestionRow[]> {
      return db
        .select()
        .from(sellerQuestion)
        .where(
          and(
            eq(sellerQuestion.sellerId, owner.sellerId),
            eq(sellerQuestion.state, "open"),
            ownerScope(owner),
          ),
        )
        .orderBy(asc(sellerQuestion.createdAt))
        .limit(50);
    },
    async askSeller(
      buyer: BuyerPrincipal,
      input: AskInput,
    ): Promise<{
      question: SellerQuestionRow;
      created: boolean;
      updated: boolean;
    }> {
      const question = input.question.trim(),
        goal = input.customerGoal.trim();
      if (!question || !goal)
        throw invalid("The question and the customer's goal are both needed.");
      const [chat] = await db
        .select({ id: conversation.id })
        .from(conversation)
        .where(
          and(
            eq(conversation.sellerId, buyer.sellerId),
            eq(conversation.buyerSessionId, buyer.buyerSessionId),
          ),
        );
      if (!chat) throw notFound("This conversation was not found.");
      const waiting = await readWaiting(buyer),
        execution = crypto.randomUUID(),
        id = waiting?.id ?? crypto.randomUUID();
      const values = {
        question: question.slice(0, 500),
        customerGoal: goal.slice(0, 500),
        knownFacts: input.knownFacts
          .map((f) => f.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 10),
      };
      if (waiting && input.replacePending && waiting.state !== "open")
        throw conflict(
          "The seller has already answered this request. Read their answer before sending a revised request.",
        );
      const changed = Boolean(
        waiting &&
          input.replacePending &&
          (waiting.question !== values.question ||
            waiting.customerGoal !== values.customerGoal ||
            JSON.stringify(waiting.knownFacts) !==
              JSON.stringify(values.knownFacts)),
      );
      try {
        const results = await db.batch([
          batchGuard(
            db,
            `${execution}:question`,
            sql`${buyerScope(buyer)} and exists(select 1 from conversation where id=${chat.id} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId})
            and ${waiting ? sql`exists(select 1 from seller_question where id=${id} and revision=${waiting.revision} and state=${waiting.state})` : sql`not exists(select 1 from seller_question where conversation_id=${chat.id} and state in ('open','answered'))`}`,
          ),
          ...(!waiting
            ? [
                db
                  .insert(sellerQuestion)
                  .values({
                    ...values,
                    id,
                    sellerId: buyer.sellerId,
                    buyerSessionId: buyer.buyerSessionId,
                    conversationId: chat.id,
                  }),
              ]
            : changed
              ? [
                  db
                    .update(sellerQuestion)
                    .set({ ...values, revision: waiting.revision + 1 })
                    .where(eq(sellerQuestion.id, id)),
                ]
              : []),
          ...(!waiting || changed
            ? [
                db
                  .insert(auditEvent)
                  .values({
                    actor: "assistant",
                    actorId: buyer.buyerSessionId,
                    operation: changed
                      ? "revise_seller_question"
                      : "ask_seller",
                    targetType: "seller_question",
                    targetId: id,
                    outcome: "ok",
                  }),
              ]
            : []),
          db.select().from(sellerQuestion).where(eq(sellerQuestion.id, id)),
          clearBatchGuards(db, execution),
        ]);
        return {
          question: (results[results.length - 2] as SellerQuestionRow[])[0]!,
          created: !waiting,
          updated: changed,
        };
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const [scope] = await db
            .select({ id: conversation.id })
            .from(conversation)
            .where(and(eq(conversation.id, chat.id), buyerScope(buyer)));
          if (!scope && buyer.assistantTurn) throw new AssistantTurnEnded();
          const winner = await readWaiting(buyer);
          if (scope && winner && !input.replacePending)
            return { question: winner, created: false, updated: false };
          throw conflict(
            "The seller request changed while you were updating it. Read the current answer before trying again.",
          );
        }
        throw error;
      }
    },
    async answerQuestion(
      owner: OwnerPrincipal,
      input: { questionId: string; expectedRevision: number; answer: string },
    ): Promise<SellerQuestionRow> {
      const answer = input.answer.trim();
      if (!answer) throw invalid("Write the answer the customer should get.");
      if (answer.length > 1000)
        throw invalid("Keep the answer under 1,000 characters.");
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:answer`,
            sql`${ownerScope(owner)} and exists(select 1 from seller_question where id=${input.questionId} and seller_id=${owner.sellerId} and state='open' and revision=${input.expectedRevision})`,
          ),
          db
            .update(sellerQuestion)
            .set({
              state: "answered",
              answer,
              answeredAt: new Date(),
              revision: sql`${sellerQuestion.revision}+1`,
            })
            .where(eq(sellerQuestion.id, input.questionId))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "answer_seller_question",
              targetType: "seller_question",
              targetId: input.questionId,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const [owned] = await db
            .select({ id: sellerQuestion.id })
            .from(sellerQuestion)
            .where(
              and(
                eq(sellerQuestion.id, input.questionId),
                eq(sellerQuestion.sellerId, owner.sellerId),
                ownerScope(owner),
              ),
            );
          if (!owned) throw notFound("That question was not found.");
          throw conflict(
            "This question was already answered or changed. Reload to see it.",
          );
        }
        throw error;
      }
    },
    async claimResume(
      questionId: string,
    ): Promise<SellerQuestionRow | undefined> {
      await closeExpired(db, questionId);
      return (
        await db
          .update(sellerQuestion)
          .set({
            resumedAt: new Date(),
            resumeClaimId: crypto.randomUUID(),
            resumeAttempts: sql`${sellerQuestion.resumeAttempts}+1`,
          })
          .where(and(eq(sellerQuestion.id, questionId), resumable))
          .returning()
      )[0];
    },
    async completeResume(claim: ResumeCompletion): Promise<boolean> {
      if (!claim.resumeClaimId) return false;
      const rows = await db
        .update(sellerQuestion)
        .set({ state: "resumed", resumeError: null })
        .where(
          and(
            liveResume(claim),
            sql`${sellerQuestion.resumedAt}>=${nowMilliseconds}-120000`,
          ),
        )
        .returning({ id: sellerQuestion.id });
      return rows.length === 1;
    },
    async releaseResume(
      claim: ResumeCompletion,
      problem: string,
    ): Promise<void> {
      if (!claim.resumeClaimId) return;
      await db
        .update(sellerQuestion)
        .set({
          state: sql`case when ${sellerQuestion.resumeAttempts}>=${MAX_RESUME_ATTEMPTS} then 'closed' else 'answered' end`,
          resumedAt: null,
          resumeClaimId: null,
          resumeError: problem.slice(0, 300),
        })
        .where(liveResume(claim));
    },
    async deferResume(claim: ResumeCompletion, until: Date): Promise<void> {
      if (!claim.resumeClaimId) return;
      await db
        .update(sellerQuestion)
        .set({
          resumedAt: null,
          resumeClaimId: null,
          resumeAfter: until,
          resumeAttempts: sql`${sellerQuestion.resumeAttempts}-1`,
        })
        .where(liveResume(claim));
    },
    async dueResumes(limit: number): Promise<string[]> {
      await closeExpired(db);
      return (
        await db
          .select({ id: sellerQuestion.id })
          .from(sellerQuestion)
          .where(resumable)
          .orderBy(asc(sellerQuestion.answeredAt))
          .limit(limit)
      ).map((row) => row.id);
    },
  };
}
