/**
 * Seller questions pause a customer's conversation until the owner answers.
 * One question waits per conversation, an answer lands only on the version the
 * owner saw, another shop cannot touch it, and a resume is claimed once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb, transaction } from "@/server/db/client";
import { sellerQuestion } from "@/server/db/schema";
import { ensureConversation } from "@/server/ai/conversation";
import type { DomainError } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { answerQuestion, askSeller, claimResume, completeResume, dueResumes, openQuestions, releaseResume, waitingQuestion } from "@/server/domain/seller-questions";
import { newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as DomainError).code ?? "error";
  }
}

const ASK = { question: "Can a Friday drop-off be ready before Saturday?", customerGoal: "Brake service done before a Saturday ride", knownFacts: ["Hydraulic brakes", "Budget $150"] };

beforeEach(async () => {
  ({ owner } = await resetShop());
});

describe("seller questions", () => {
  it("revises an explicitly corrected pending request and rejects the seller's stale answer", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question: original } = await askSeller(buyer, ASK);
    const corrected = { question: "Can the brake repair be ready by Monday for $80?", customerGoal: "Repair before Monday within $80", knownFacts: ["Rear hydraulic brake", "Monday deadline", "$80 maximum"], replacePending: true };
    const { question: revised } = await askSeller(buyer, corrected);
    expect(revised.id).toBe(original.id);
    expect(revised.question).toBe(corrected.question);
    expect(revised.knownFacts).toEqual(corrected.knownFacts);
    expect(revised.revision).toBe(original.revision + 1);
    expect((await askSeller(buyer, corrected)).question.revision).toBe(revised.revision);
    expect(await code(answerQuestion(owner, { questionId: original.id, expectedRevision: original.revision, answer: "Saturday for $150 works." }))).toBe("conflict");
    expect((await openQuestions(owner))).toHaveLength(1);
    const answer = await answerQuestion(owner, { questionId: revised.id, expectedRevision: revised.revision, answer: "Monday works, but $80 does not cover this repair." });
    expect(answer.answer).toContain("Monday");
  });

  it("cannot replace a request after the seller has answered it", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Friday drop-off is available." });
    expect(await code(askSeller(buyer, { ...ASK, question: "Replace with Monday instead.", replacePending: true }))).toBe("conflict");
    expect((await waitingQuestion(buyer))?.answer).toBe("Friday drop-off is available.");
  });

  it("a seller answer racing a correction cannot silently answer the wrong revision", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    const results = await Promise.allSettled([
      askSeller(buyer, { ...ASK, question: "Can Monday work for $80?", replacePending: true }),
      answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Friday works." }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const current = await waitingQuestion(buyer);
    if (current?.state === "answered") expect(current.question).toBe(ASK.question);
    else expect(current).toMatchObject({ state: "open", question: "Can Monday work for $80?", answer: null });
  });
  it("one question waits per conversation; asking again returns the same one", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const first = await askSeller(buyer, ASK);
    const second = await askSeller(buyer, { ...ASK, question: "Is Saturday morning possible?" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.question.id).toBe(first.question.id);
    expect((await openQuestions(owner)).map((q) => q.id)).toEqual([first.question.id]);
  });

  it("an answer lands only on the version the owner saw, and only for this shop", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    const stranger: OwnerPrincipal = { kind: "owner", userId: owner.userId, sellerId: crypto.randomUUID() };
    expect(await code(answerQuestion(stranger, { questionId: question.id, expectedRevision: question.revision, answer: "Yes" }))).toBe("not_found");
    const answered = await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes, drop it off by 10:00 Friday." });
    expect(answered.state).toBe("answered");
    expect(await code(answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "No" }))).toBe("conflict");
    expect((await waitingQuestion(buyer))?.answer).toBe("Yes, drop it off by 10:00 Friday.");
  });

  it("a resume is claimed once, and a finished one is no longer due", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes." });
    expect(await dueResumes(10)).toContain(question.id);
    const [a, b] = await Promise.all([claimResume(question.id), claimResume(question.id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await dueResumes(10)).not.toContain(question.id);
    await completeResume((a ?? b)!);
    expect(await waitingQuestion(buyer)).toBeUndefined();
  });

  it("an expired worker cannot complete or release the replacement worker's claim", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes." });
    const old = (await claimResume(question.id))!;
    await getDb().update(sellerQuestion).set({ resumedAt: sql`now() - interval '3 minutes'` }).where(eq(sellerQuestion.id, question.id));
    expect(await completeResume(old)).toBe(false);
    const replacement = (await claimResume(question.id))!;
    expect(await completeResume(old)).toBe(false);
    await releaseResume(old, "stale worker failed");
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: replacement.resumeAttempts, resumeError: null });
    expect(row?.resumedAt).not.toBeNull();
    expect(await completeResume(replacement)).toBe(true);
  });

  it("rolls back success when saving the continuation fails in the same transaction", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    const { question } = await askSeller(buyer, ASK);
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes." });
    const claim = (await claimResume(question.id))!;
    await expect(transaction(getDb(), async (tx) => {
      expect(await completeResume(claim, tx)).toBe(true);
      throw new Error("message storage unavailable");
    })).rejects.toThrow("message storage unavailable");
    expect((await waitingQuestion(buyer))?.state).toBe("answered");
  });
});
