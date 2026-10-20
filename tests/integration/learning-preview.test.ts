/** @fileoverview Contract tests use labeled synthetic stored results, never mocked successful model calls. */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureConversation } from "@/server/ai/conversation";
import { learningPreviewTools, previewModelFacts } from "@/server/ai/learning-preview";
import { getDb } from "@/server/db/client";
import { learningPreview, learningReview, sellerQuestion } from "@/server/db/schema";
import { askSeller, answerQuestion } from "@/server/domain/seller-questions";
import { claimLearningReview, learningSource, saveLearningReview } from "@/server/domain/learning-review";
import { saveLearningDraft } from "@/server/domain/learning-draft";
import { claimLearningPreview, failLearningPreview, listLearningPreviews, savePreviewAnswer } from "@/server/domain/learning-preview";
import { readShopGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const contractAnswer = { text: "SYNTHETIC persistence fixture, not an AI answer.", latencyMs: 1, inputTokens: null, outputTokens: null, reads: ["read_shop_facts" as const] };
async function prepare() {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Which entrance?", customerGoal: "Find the entrance", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Use the blue door. For Jo only, knock after hours." });
  const source = await learningSource(owner, question.id); const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("fresh claim required");
  const review = await saveLearningReview(owner, source, { summary: "Entrance fact", findings: [{ kind: "reusable_fact", title: "Shop entrance", explanation: "Reusable directions", answerQuote: "Use the blue door.", proposedFact: "Use the blue door.", scope: "All customers", questions: [], conflictingGuideIds: [], conflictingPolicyFields: [], conflictingProductIds: [] }] }, "synthetic-contract-fixture", claim.claim);
  const draft = { findingIndex: 0, title: "Entrance", body: "Use the blue door facing Main Street.", topic: "general" as const, productId: null, validUntil: null, clarification: "Private clarification for the owner only.", conflicts: [] };
  const saved = await saveLearningDraft(owner, { reviewId: review.id, expectedRevision: review.revision, draft });
  return { buyer, review, draft, input: { requestId: crypto.randomUUID(), reviewId: review.id, expectedRevision: saved.revision, findingIndex: 0, question: "Which entrance should I use?" } };
}

describe("private saved-answer comparisons", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  it("passes only public facts to a read-only tool and changes no published knowledge or commerce", async () => {
    const { buyer, draft, input } = await prepare(); const before = await tally();
    const run = await claimLearningPreview(owner, input, "contract-fixture");
    expect(run.created).toBe(true);
    expect(run.row.currentFacts.guides).toEqual([]);
    expect(run.row.proposedFacts.guides.at(-1)?.body).toBe(draft.body);
    const modelFacts = JSON.stringify(previewModelFacts(run.row.proposedFacts));
    for (const privateText of ["Jo", "after hours", "Private clarification", input.reviewId, input.requestId]) expect(modelFacts).not.toContain(privateText);
    expect(Object.keys(learningPreviewTools(run.row.proposedFacts))).toEqual(["read_shop_facts"]);
    expect((await readShopGuide(buyer)).sources).toEqual([]); expect(await tally()).toEqual(before);
  });
  it("reuses the same request exactly and refuses changed retries or concurrent second runs", async () => {
    const { input } = await prepare();
    const runs = await Promise.all([claimLearningPreview(owner, input, "contract-fixture"), claimLearningPreview(owner, input, "contract-fixture")]);
    expect(runs.filter(run => run.created)).toHaveLength(1);
    expect(runs.map(run => run.row.id)).toEqual([input.requestId, input.requestId]);
    await expect(claimLearningPreview(owner, { ...input, question: "A changed question?" }, "contract-fixture")).rejects.toMatchObject({ code: "conflict" });
    await expect(claimLearningPreview(owner, { ...input, requestId: crypto.randomUUID() }, "contract-fixture")).rejects.toMatchObject({ code: "conflict" });
  });
  it("checks owner identity for creation, results, failure and reads", async () => {
    const { input } = await prepare(); const run = await claimLearningPreview(owner, input, "contract-fixture");
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
      await expect(claimLearningPreview(caller, input, "contract-fixture")).rejects.toMatchObject({ code: "not_found" });
      await expect(savePreviewAnswer(caller, run.row.id, "current", contractAnswer)).rejects.toMatchObject({ code: "not_found" });
      await expect(failLearningPreview(caller, run.row.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(listLearningPreviews(caller)).rejects.toMatchObject({ code: "not_found" });
    }
  });
  it("keeps the first answer when the second fails and forbids overwriting historical results", async () => {
    const { input } = await prepare(); await claimLearningPreview(owner, input, "contract-fixture");
    await expect(savePreviewAnswer(owner, input.requestId, "proposed", contractAnswer)).rejects.toMatchObject({ code: "conflict" });
    await savePreviewAnswer(owner, input.requestId, "current", contractAnswer);
    await failLearningPreview(owner, input.requestId);
    const [report] = await listLearningPreviews(owner);
    expect(report).toMatchObject({ state: "failed", current: contractAnswer, proposed: null });
    expect(report).not.toHaveProperty("currentFacts");
    await expect(savePreviewAnswer(owner, input.requestId, "proposed", contractAnswer)).rejects.toMatchObject({ code: "conflict" });
  });
  it("requires two ordered nonempty results, then preserves the completed comparison", async () => {
    const { input } = await prepare(); await claimLearningPreview(owner, input, "contract-fixture");
    await expect(savePreviewAnswer(owner, input.requestId, "current", { ...contractAnswer, text: " " })).rejects.toThrow();
    await savePreviewAnswer(owner, input.requestId, "current", contractAnswer);
    await savePreviewAnswer(owner, input.requestId, "proposed", contractAnswer);
    await failLearningPreview(owner, input.requestId);
    expect((await listLearningPreviews(owner))[0]).toMatchObject({ state: "completed", current: contractAnswer, proposed: contractAnswer });
    await expect(savePreviewAnswer(owner, input.requestId, "current", contractAnswer)).rejects.toMatchObject({ code: "conflict" });
  });
  it("reports abandoned work without mutating on read and permits a fresh comparison", async () => {
    const { input } = await prepare(); await claimLearningPreview(owner, input, "contract-fixture");
    await getDb().update(learningPreview).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(learningPreview.id, input.requestId));
    expect((await listLearningPreviews(owner))[0]?.state).toBe("failed");
    expect((await getDb().select().from(learningPreview))[0]?.state).toBe("running");
    await expect(savePreviewAnswer(owner, input.requestId, "current", contractAnswer)).rejects.toMatchObject({ code: "conflict" });
    expect((await claimLearningPreview(owner, { ...input, requestId: crypto.randomUUID() }, "contract-fixture")).created).toBe(true);
    expect((await getDb().select().from(learningPreview).where(eq(learningPreview.id, input.requestId)))[0]?.state).toBe("failed");
  });
  it("refuses private exceptions, incomplete drafts and a stale review", async () => {
    const { input, review } = await prepare();
    await expect(claimLearningPreview(owner, { ...input, expectedRevision: 1 }, "contract-fixture")).rejects.toMatchObject({ code: "conflict" });
    await getDb().update(learningReview).set({ editedDrafts: [] }).where(eq(learningReview.id, review.id));
    await expect(claimLearningPreview(owner, input, "contract-fixture")).rejects.toMatchObject({ code: "invalid" });
    await getDb().update(learningReview).set({ analysis: { ...review.analysis, findings: review.analysis.findings.map(f => ({ ...f, kind: "customer_exception", proposedFact: null })) } }).where(eq(learningReview.id, review.id));
    await expect(claimLearningPreview(owner, input, "contract-fixture")).rejects.toMatchObject({ code: "invalid" });
  });
  it("refuses a draft when the actual seller answer has changed", async () => {
    const { input, review } = await prepare();
    await getDb().update(sellerQuestion).set({ answer: "Use the red door now.", revision: 3 }).where(eq(sellerQuestion.id, review.questionId));
    await expect(claimLearningPreview(owner, input, "contract-fixture")).rejects.toMatchObject({ code: "conflict" });
    expect(await listLearningPreviews(owner)).toEqual([]);
  });
});
