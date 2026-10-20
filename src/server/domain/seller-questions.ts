import { getStorage } from "@/server/storage";
/**
 * Questions the buyer agent puts to the seller. A question pauses that
 * customer's conversation; the seller's answer is stored, then a background
 * continuation resumes the same conversation with a new model turn.
 *
 * One question waits per conversation at a time (a partial unique index).
 * Answers are bound to the question's revision, so a stale form cannot
 * overwrite a newer answer, and a resume is claimed once.
 */
import { getDb, transaction, type Queryable } from "@/server/db/client";
import { conversation, sellerQuestion } from "@/server/db/schema";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { assertAssistantTurn } from "./assistant-turn";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

export type SellerQuestionRow = typeof sellerQuestion.$inferSelect;

/** How many times a resumed turn is retried before the question is closed with its error. */
export const MAX_RESUME_ATTEMPTS = 3;

const WAITING = ["open", "answered"] as const;

/** A new seller question, or an explicit correction to this buyer's pending request. */
export type AskInput = {
  question: string;
  customerGoal: string;
  knownFacts: string[];
  replacePending?: boolean;
};

async function conversationOf(
  buyer: BuyerPrincipal,
  db: Queryable,
): Promise<string> {
  const [row] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.buyerSessionId, buyer.buyerSessionId),
        eq(conversation.sellerId, buyer.sellerId),
      ),
    );
  if (!row) throw notFound("This conversation was not found.");
  return row.id;
}

/** Saves or explicitly revises an open question; ordinary repeats retain the existing request. */
export async function askSeller(
  buyer: BuyerPrincipal,
  input: AskInput,
): Promise<{
  question: SellerQuestionRow;
  created: boolean;
  updated: boolean;
}> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.askSeller(buyer, input);

  const question = input.question.trim();
  const customerGoal = input.customerGoal.trim();
  if (!question || !customerGoal)
    throw invalid("The question and the customer's goal are both needed.");
  return transaction(getDb(), async (db) => {
    await assertAssistantTurn(buyer, db, true);
    const conversationId = await conversationOf(buyer, db);
    const [inserted] = await db
      .insert(sellerQuestion)
      .values({
        sellerId: buyer.sellerId,
        conversationId,
        buyerSessionId: buyer.buyerSessionId,
        question: question.slice(0, 500),
        customerGoal: customerGoal.slice(0, 500),
        knownFacts: input.knownFacts
          .map((fact) => fact.trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 10),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      await recordAudit(db, {
        actor: "assistant",
        actorId: buyer.buyerSessionId,
        operation: "ask_seller",
        targetType: "seller_question",
        targetId: inserted.id,
        outcome: "ok",
      });
      return { question: inserted, created: true, updated: false };
    }
    const waiting = await waitingQuestion(buyer, db);
    if (!waiting) throw conflict("The question could not be saved. Try again.");
    if (!input.replacePending)
      return { question: waiting, created: false, updated: false };
    if (waiting.state !== "open")
      throw conflict(
        "The seller has already answered this request. Read their answer before sending a revised request.",
      );
    const changes = {
      question: question.slice(0, 500),
      customerGoal: customerGoal.slice(0, 500),
      knownFacts: input.knownFacts
        .map((fact) => fact.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 10),
    };
    if (
      waiting.question === changes.question &&
      waiting.customerGoal === changes.customerGoal &&
      JSON.stringify(waiting.knownFacts) === JSON.stringify(changes.knownFacts)
    )
      return { question: waiting, created: false, updated: false };
    const tx = db;
    const [revised] = await tx
      .update(sellerQuestion)
      .set({
        ...changes,
        revision: sql`${sellerQuestion.revision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sellerQuestion.id, waiting.id),
          eq(sellerQuestion.sellerId, buyer.sellerId),
          eq(sellerQuestion.buyerSessionId, buyer.buyerSessionId),
          eq(sellerQuestion.state, "open"),
          eq(sellerQuestion.revision, waiting.revision),
        ),
      )
      .returning();
    if (!revised)
      throw conflict(
        "The seller request changed while you were updating it. Read the current answer before trying again.",
      );
    await recordAudit(tx, {
      actor: "assistant",
      actorId: buyer.buyerSessionId,
      operation: "revise_seller_question",
      targetType: "seller_question",
      targetId: revised.id,
      outcome: "ok",
    });
    return { question: revised, created: false, updated: true };
  });
}

/** The question this buyer's conversation is waiting on, if any. */
export async function waitingQuestion(
  buyer: BuyerPrincipal,
  db?: Queryable,
): Promise<SellerQuestionRow | undefined> {
  const backend = getStorage();
  if (!db && backend.kind === "d1")
    return backend.questions.waitingQuestion(buyer);
  db ??= getDb();

  const [row] = await db
    .select()
    .from(sellerQuestion)
    .where(
      and(
        eq(sellerQuestion.buyerSessionId, buyer.buyerSessionId),
        eq(sellerQuestion.sellerId, buyer.sellerId),
        inArray(sellerQuestion.state, [...WAITING]),
      ),
    );
  return row;
}

/** The buyer's most recent question in any state. */
export async function latestQuestion(
  buyer: BuyerPrincipal,
): Promise<SellerQuestionRow | undefined> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.latestQuestion(buyer);

  const [row] = await getDb()
    .select()
    .from(sellerQuestion)
    .where(
      and(
        eq(sellerQuestion.buyerSessionId, buyer.buyerSessionId),
        eq(sellerQuestion.sellerId, buyer.sellerId),
      ),
    )
    .orderBy(desc(sellerQuestion.createdAt))
    .limit(1);
  return row;
}

/** Questions waiting for this owner, oldest first. */
export async function openQuestions(
  owner: OwnerPrincipal,
): Promise<SellerQuestionRow[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.openQuestions(owner);

  return getDb()
    .select()
    .from(sellerQuestion)
    .where(
      and(
        eq(sellerQuestion.sellerId, owner.sellerId),
        eq(sellerQuestion.state, "open"),
      ),
    )
    .orderBy(asc(sellerQuestion.createdAt))
    .limit(50);
}

/**
 * Records the owner's answer. Only an open question at the expected revision
 * changes; anything else is a conflict and the owner sees the current state.
 * A caller may supply its transaction to commit an answer with a reviewed quote.
 */
export async function answerQuestion(
  owner: OwnerPrincipal,
  input: { questionId: string; expectedRevision: number; answer: string },
  db?: Queryable,
): Promise<SellerQuestionRow> {
  const backend = getStorage();
  if (!db && backend.kind === "d1")
    return backend.questions.answerQuestion(owner, input);
  db ??= getDb();

  const answer = input.answer.trim();
  if (!answer) throw invalid("Write the answer the customer should get.");
  if (answer.length > 1000)
    throw invalid("Keep the answer under 1,000 characters.");
  const [updated] = await db
    .update(sellerQuestion)
    .set({
      state: "answered",
      answer,
      answeredAt: sql`now()`,
      revision: sql`${sellerQuestion.revision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sellerQuestion.id, input.questionId),
        eq(sellerQuestion.sellerId, owner.sellerId),
        eq(sellerQuestion.state, "open"),
        eq(sellerQuestion.revision, input.expectedRevision),
      ),
    )
    .returning();
  if (!updated) {
    const [existing] = await db
      .select({ id: sellerQuestion.id })
      .from(sellerQuestion)
      .where(
        and(
          eq(sellerQuestion.id, input.questionId),
          eq(sellerQuestion.sellerId, owner.sellerId),
        ),
      );
    if (!existing) throw notFound("That question was not found.");
    throw conflict(
      "This question was already answered or changed. Reload to see it.",
    );
  }
  await recordAudit(db, {
    actor: "owner",
    actorId: owner.userId,
    operation: "answer_seller_question",
    targetType: "seller_question",
    targetId: updated.id,
    outcome: "ok",
  });
  return updated;
}

/** How long one resume may run before another runner may take it over (crash recovery). */
const RESUME_LEASE = sql`interval '2 minutes'`;

const assistantOwned = sql`exists (select 1 from ${conversation} where ${conversation.id} = ${sellerQuestion.conversationId} and ${conversation.sellerId} = ${sellerQuestion.sellerId} and ${conversation.handler} = 'assistant')`;

const resumable = and(
  assistantOwned,
  eq(sellerQuestion.state, "answered"),
  sql`${sellerQuestion.resumeAfter} <= now()`,
  lt(sellerQuestion.resumeAttempts, MAX_RESUME_ATTEMPTS),
  sql`(${sellerQuestion.resumedAt} is null or ${sellerQuestion.resumedAt} < now() - ${RESUME_LEASE})`,
);

/**
 * Takes a lease on one answered question so a single runner resumes it.
 * Returns nothing if another runner holds a live lease or it is done.
 */
export async function claimResume(
  questionId: string,
): Promise<SellerQuestionRow | undefined> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.claimResume(questionId);

  await closeExpiredResumes(questionId);
  const [claimed] = await getDb()
    .update(sellerQuestion)
    .set({
      resumedAt: sql`now()`,
      resumeClaimId: crypto.randomUUID(),
      resumeAttempts: sql`${sellerQuestion.resumeAttempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(sellerQuestion.id, questionId), resumable))
    .returning();
  return claimed;
}

/** Marks only this live claim complete. The caller saves its reply in the same transaction. */
export async function completeResume(
  claim: Pick<SellerQuestionRow, "id" | "resumeAttempts" | "resumeClaimId">,
  db?: Queryable,
): Promise<boolean> {
  const backend = getStorage();
  if (!db && backend.kind === "d1")
    return backend.questions.completeResume(claim);
  db ??= getDb();

  if (!claim.resumeClaimId) return false;
  const rows = await db
    .update(sellerQuestion)
    .set({ state: "resumed", resumeError: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(sellerQuestion.id, claim.id),
        eq(sellerQuestion.resumeClaimId, claim.resumeClaimId),
        eq(sellerQuestion.state, "answered"),
        eq(sellerQuestion.resumeAttempts, claim.resumeAttempts),
        sql`${sellerQuestion.resumedAt} >= now() - ${RESUME_LEASE}`,
      ),
    )
    .returning({ id: sellerQuestion.id });
  return rows.length === 1;
}

/** After a failed resume: due again at once, or closed with its error once the attempts run out. */
export async function releaseResume(
  claim: Pick<SellerQuestionRow, "id" | "resumeAttempts" | "resumeClaimId">,
  problem: string,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.questions.releaseResume(claim, problem);

  if (!claim.resumeClaimId) return;
  await getDb()
    .update(sellerQuestion)
    .set({
      state: sql`case when ${sellerQuestion.resumeAttempts} >= ${MAX_RESUME_ATTEMPTS} then 'closed' else 'answered' end`,
      resumedAt: null,
      resumeClaimId: null,
      resumeError: problem.slice(0, 300),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sellerQuestion.id, claim.id),
        eq(sellerQuestion.resumeClaimId, claim.resumeClaimId),
        eq(sellerQuestion.state, "answered"),
        eq(sellerQuestion.resumeAttempts, claim.resumeAttempts),
      ),
    );
}

/** Postpones a continuation that never reached the model without consuming its retry allowance. */
export async function deferResume(
  claim: Pick<SellerQuestionRow, "id" | "resumeAttempts" | "resumeClaimId">,
  until: Date,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.deferResume(claim, until);

  if (!claim.resumeClaimId) return;
  await getDb()
    .update(sellerQuestion)
    .set({
      resumedAt: null,
      resumeClaimId: null,
      resumeAfter: until,
      resumeAttempts: sql`${sellerQuestion.resumeAttempts} - 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sellerQuestion.id, claim.id),
        eq(sellerQuestion.resumeClaimId, claim.resumeClaimId),
        eq(sellerQuestion.state, "answered"),
        eq(sellerQuestion.resumeAttempts, claim.resumeAttempts),
      ),
    );
}

async function closeExpiredResumes(questionId?: string): Promise<void> {
  await getDb()
    .update(sellerQuestion)
    .set({
      state: "closed",
      resumedAt: null,
      resumeError:
        "The assistant could not finish after three attempts. The seller's answer is saved; the customer can continue the conversation.",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        assistantOwned,
        questionId ? eq(sellerQuestion.id, questionId) : undefined,
        eq(sellerQuestion.state, "answered"),
        sql`${sellerQuestion.resumeAttempts} >= ${MAX_RESUME_ATTEMPTS}`,
        sql`(${sellerQuestion.resumedAt} is null or ${sellerQuestion.resumedAt} < now() - ${RESUME_LEASE})`,
      ),
    );
}

/** Answered questions whose conversation still needs its continuation. */
export async function dueResumes(limit: number): Promise<string[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.questions.dueResumes(limit);

  await closeExpiredResumes();
  const rows = await getDb()
    .select({ id: sellerQuestion.id })
    .from(sellerQuestion)
    .where(resumable)
    .orderBy(asc(sellerQuestion.answeredAt))
    .limit(limit);
  return rows.map((row) => row.id);
}
