/** @fileoverview Real database contract tests for private, source-backed learning reviews. No model calls are simulated as live evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { LearningAnalysis, LearningSource } from "@/lib/learning-review";
import { ensureConversation } from "@/server/ai/conversation";
import { draftLearningReview } from "@/server/ai/learning-review";
import { resetServerConfigForTests } from "@/server/env";
import { getDb } from "@/server/db/client";
import { sellerQuestion } from "@/server/db/schema";
import { askSeller, answerQuestion } from "@/server/domain/seller-questions";
import { learningSource, learningWorkspace, saveLearningReview as persistReview, claimLearningReview, releaseLearningClaim, listLearningReviews, decideLearningReview } from "@/server/domain/learning-review";
import { readShopGuide, saveGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

async function saveLearningReview(caller: OwnerPrincipal, source: LearningSource, value: unknown, generator: string) {
  const run = await claimLearningReview(caller, source);
  if (run.state === "ready") return run.review;
  try { return await persistReview(caller, source, value, generator, run.claim); }
  finally { await releaseLearningClaim(caller, run.claim); }
}

let owner: OwnerPrincipal;
const ANSWER = "For this customer only, pickup at 8pm is fine. Our normal pickup ends at 6pm.";
const analysis: LearningAnalysis = { summary: "A private exception and a normal pickup rule.", findings: [
  { kind: "customer_exception", title: "Late pickup exception", explanation: "Only this customer's pickup changes.", answerQuote: "For this customer only, pickup at 8pm is fine.", proposedFact: null, scope: "This conversation only", questions: [], conflictingPolicyFields: [], conflictingProductIds: [], coveredByGuideIds: [], conflictingGuideIds: [] },
  { kind: "reusable_fact", title: "Normal pickup hours", explanation: "The owner distinguishes the usual closing time.", answerQuote: "Our normal pickup ends at 6pm.", proposedFact: "Normal pickup ends at 6pm.", scope: "All pickups; timezone still needs confirmation", questions: ["Which timezone applies?"], conflictingPolicyFields: [], conflictingProductIds: [], coveredByGuideIds: [], conflictingGuideIds: [] },
] };
async function answered() {
  const buyer = await newBuyer();
  await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Can I collect at 8pm?", customerGoal: "Collect after work", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: ANSWER });
  return { buyer, source: await learningSource(owner, question.id) };
}

describe("private reviewed learning", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServerConfigForTests(); });
  it("refuses overlapping generation before a second provider request", async () => {
    const { source } = await answered();
    vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL_ID", "refusal-test"); vi.stubEnv("OPENAI_API_KEY", "test-key-not-transmitted");
    resetServerConfigForTests();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async () => { await held; return new Response('{"error":{"message":"local test refusal"}}', { status: 401, headers: { "content-type": "application/json" } }); });
    vi.stubGlobal("fetch", fetcher);
    const first = draftLearningReview(owner, source.questionId).catch(error => error);
    let second: Promise<unknown> | undefined;
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      let secondError: unknown;
      second = draftLearningReview(owner, source.questionId).catch(error => { secondError = error; });
      await vi.waitFor(() => expect(secondError).toMatchObject({ code: "conflict" }), { timeout: 1000 });
    } finally { release(); await first; await second?.catch(() => {}); }
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await listLearningReviews(owner)).toEqual([]);
  });
  it("keeps evidence and classifications private without changing commerce or buyer knowledge", async () => {
    const { buyer, source } = await answered();
    const before = await tally();
    const review = await saveLearningReview(owner, source, analysis, "synthetic-contract-fixture");
    expect(review).toMatchObject({ state: "draft", revision: 1, source, analysis });
    expect((await listLearningReviews(owner))[0]?.id).toBe(review.id);
    expect((await readShopGuide(buyer)).sources).toEqual([]);
    expect(await tally()).toEqual(before);
  });
  it("rejects unanswered sources and invented seller evidence", async () => {
    const buyer = await newBuyer();
  await ensureConversation(buyer);
    const { question } = await askSeller(buyer, { question: "Refund me?", customerGoal: "Refund", knownFacts: [] });
    await expect(learningSource(owner, question.id)).rejects.toMatchObject({ code: "invalid" });
    const { source } = await answered();
    await expect(saveLearningReview(owner, source, { ...analysis, findings: [{ ...analysis.findings[0]!, answerQuote: "Everyone can collect at 8pm." }] }, "fixture")).rejects.toThrow(/evidence/);
    await expect(saveLearningReview(owner, source, { ...analysis, findings: [{ ...analysis.findings[0]!, proposedFact: "Pickup is open until 8pm." }] }, "fixture")).rejects.toThrow(/exceptions/);
    expect(await listLearningReviews(owner)).toEqual([]);
  });
  it("leaves no fabricated review when no real model is configured", async () => {
    const { source } = await answered();
    await expect(draftLearningReview(owner, source.questionId)).rejects.toMatchObject({ code: "unavailable" });
    expect(await listLearningReviews(owner)).toEqual([]);
    const retry = await claimLearningReview(owner, source);
    expect(retry.state).toBe("claimed");
  });
  it("fences expired generations and never releases a replacement worker", async () => {
    const { source } = await answered();
    const first = await claimLearningReview(owner, source);
    if (first.state !== "claimed") throw new Error("expected first claim");
    await getDb().update(sellerQuestion).set({ reviewClaimExpiresAt: sql`now() - interval '1 second'` }).where(eq(sellerQuestion.id, source.questionId));
    const next = await claimLearningReview(owner, source);
    if (next.state !== "claimed") throw new Error("expected replacement claim");
    await releaseLearningClaim(owner, first.claim);
    await expect(persistReview(owner, source, analysis, "fixture", first.claim)).rejects.toMatchObject({ code: "conflict" });
    await expect(claimLearningReview(owner, source)).rejects.toMatchObject({ code: "conflict" });
    expect((await persistReview(owner, source, analysis, "fixture", next.claim)).analysis).toEqual(analysis);
  });
  it("shows current answers, flags stale findings and retains review decisions across reads", async () => {
    expect(await learningWorkspace(owner)).toEqual([]);
    const { source } = await answered();
    expect((await learningWorkspace(owner))[0]).toMatchObject({ questionId: source.questionId, answer: ANSWER, review: null });
    const review = await saveLearningReview(owner, source, analysis, "fixture");
    expect((await learningWorkspace(owner))[0]?.review).toMatchObject({ id: review.id, stale: false, state: "draft" });
    await decideLearningReview(owner, { id: review.id, expectedRevision: review.revision, state: "deferred" });
    await saveGuide(owner, { title: "New pickup hours", topic: "general", body: "Pickup now ends at 5pm.", published: true, actionLabel: "", actionUrl: "", productId: null, validUntil: null });
    expect((await learningWorkspace(owner))[0]?.review).toMatchObject({ id: review.id, stale: true, state: "deferred", source });
    const current = await learningSource(owner, source.questionId);
    const replacement = await saveLearningReview(owner, current, analysis, "fixture");
    expect((await learningWorkspace(owner))[0]?.review).toMatchObject({ id: replacement.id, stale: false, state: "draft" });
    expect(await listLearningReviews(owner)).toHaveLength(2);
  });
  it("rejects unknown conflict references and stale knowledge snapshots", async () => {
    const { source } = await answered();
    await expect(saveLearningReview(owner, source, { ...analysis, findings: [{ ...analysis.findings[0]!, conflictingGuideIds: [crypto.randomUUID()] }] }, "fixture")).rejects.toThrow(/outside/);
    await saveGuide(owner, { title: "Pickup hours", topic: "general", body: "Pickup ends at 5pm every day.", published: true, actionLabel: "", actionUrl: "", productId: null, validUntil: null });
    await expect(saveLearningReview(owner, source, analysis, "fixture")).rejects.toMatchObject({ code: "conflict" });
    expect(await listLearningReviews(owner)).toEqual([]);
  });
  it("rejects a source changed while a model is generating", async () => {
    const { source } = await answered();
    await getDb().update(sellerQuestion).set({ answer: "Pickup is no longer available.", revision: sql`revision + 1` }).where(eq(sellerQuestion.id, source.questionId));
    await expect(saveLearningReview(owner, source, analysis, "fixture")).rejects.toMatchObject({ code: "conflict" });
  });
  it("deduplicates concurrent saves and rejects stale decisions", async () => {
    const { source } = await answered();
    const run = await claimLearningReview(owner, source);
    if (run.state !== "claimed") throw new Error("new source should claim");
    const [first, second] = await Promise.all([persistReview(owner, source, analysis, "fixture", run.claim), persistReview(owner, source, analysis, "fixture", run.claim)]);
    expect(first.id).toBe(second.id);
    expect(await listLearningReviews(owner)).toHaveLength(1);
    // Tests have no configured model. Reopening a saved review must not need one.
    expect((await draftLearningReview(owner, source.questionId)).id).toBe(first.id);
    const deferred = await decideLearningReview(owner, { id: first.id, expectedRevision: 1, state: "deferred" });
    expect(deferred).toMatchObject({ state: "deferred", revision: 2 });
    await expect(decideLearningReview(owner, { id: first.id, expectedRevision: 1, state: "rejected" })).rejects.toMatchObject({ code: "conflict" });
    expect(await decideLearningReview(owner, { id: first.id, expectedRevision: 2, state: "rejected" })).toMatchObject({ state: "rejected", revision: 3 });
  });
  it("proves owner identity and shop scope for every operation", async () => {
    const { source } = await answered();
    const review = await saveLearningReview(owner, source, analysis, "fixture");
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
      await expect(learningSource(caller, source.questionId)).rejects.toMatchObject({ code: "not_found" });
      await expect(listLearningReviews(caller)).rejects.toMatchObject({ code: "not_found" });
      await expect(learningWorkspace(caller)).rejects.toMatchObject({ code: "not_found" });
      await expect(saveLearningReview(caller, source, analysis, "fixture")).rejects.toMatchObject({ code: "not_found" });
      await expect(decideLearningReview(caller, { id: review.id, expectedRevision: 1, state: "rejected" })).rejects.toMatchObject({ code: "not_found" });
    }
    expect((await listLearningReviews(owner))[0]?.revision).toBe(1);
  });
});
