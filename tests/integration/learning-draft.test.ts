/** @fileoverview Private seller edits survive reload, retries and concurrent saves without publication. */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { SaveLearningDraftInput } from "@/lib/learning-draft";
import { ensureConversation } from "@/server/ai/conversation";
import { getDb } from "@/server/db/client";
import { learningReview, sellerQuestion } from "@/server/db/schema";
import { askSeller, answerQuestion } from "@/server/domain/seller-questions";
import { claimLearningReview, decideLearningReview, learningSource, learningWorkspace, saveLearningReview } from "@/server/domain/learning-review";
import { saveLearningDraft } from "@/server/domain/learning-draft";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import { readShopGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
async function prepare() {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Which entrance?", customerGoal: "Find the entrance", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Use the blue door. For Jo only, knock after hours." });
  const source = await learningSource(owner, question.id); const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("fresh claim required");
  const review = await saveLearningReview(owner, source, { summary: "Entrance fact", findings: [{ kind: "reusable_fact", title: "Shop entrance", explanation: "Reusable directions", answerQuote: "Use the blue door.", proposedFact: "Use the blue door.", scope: "All customers", questions: [], conflictingGuideIds: [], conflictingPolicyFields: [], conflictingProductIds: [] }] }, "synthetic-contract-fixture", claim.claim);
  const input: SaveLearningDraftInput = { reviewId: review.id, expectedRevision: review.revision, draft: { findingIndex: 0, title: "Entrance", body: "Use the blue door facing Main Street.", topic: "general", productId: null, validUntil: null, clarification: "Private clarification", conflicts: [] } };
  return { buyer, review, input };
}
const approve = (input: SaveLearningDraftInput, revision: number) => ({ ...input.draft, conflicts: [], reviewId: input.reviewId, expectedRevision: revision, confirmReusable: true as const });

describe("private edited learning drafts", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  it("reloads incomplete edits privately; consent and publication remain separate", async () => {
    const { buyer, input } = await prepare(); const before = await tally();
    const draft = { ...input.draft, title: "", body: "" };
    const saved = await saveLearningDraft(owner, { ...input, draft });
    expect(saved.revision).toBe(2);
    expect((await learningWorkspace(owner))[0]?.review?.editedDrafts).toEqual([draft]);
    expect((await readShopGuide(buyer)).sources).toEqual([]); expect(await tally()).toEqual(before);
    await expect(saveLearningDraft(owner, { ...input, draft: { ...draft, confirmReusable: true } } as unknown as SaveLearningDraftInput)).rejects.toThrow();
  });
  it("deduplicates lost-response retries and rejects changed stale saves", async () => {
    const { input } = await prepare();
    const [a, b] = await Promise.all([saveLearningDraft(owner, input), saveLearningDraft(owner, input)]);
    expect(a).toEqual(b); expect(a.revision).toBe(2);
    await expect(saveLearningDraft(owner, { ...input, draft: { ...input.draft, body: "Old tab overwrite" } })).rejects.toMatchObject({ code: "conflict" });
    await saveLearningDraft(owner, { ...input, expectedRevision: 2, draft: { ...input.draft, body: "New version of the private draft." } });
    await expect(saveLearningDraft(owner, input)).rejects.toMatchObject({ code: "conflict" });
    expect((await learningWorkspace(owner))[0]?.review?.editedDrafts[0]?.body).toBe("New version of the private draft.");
  });
  it("allows only one of two different edits from the same revision", async () => {
    const { input } = await prepare();
    const result = await Promise.allSettled([saveLearningDraft(owner, input), saveLearningDraft(owner, { ...input, draft: { ...input.draft, body: "Different simultaneous edit" } })]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
  });
  it("refuses forged owner scope, foreign products/conflicts and nonexistent findings", async () => {
    const { input } = await prepare();
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) await expect(saveLearningDraft(caller, input)).rejects.toMatchObject({ code: "not_found" });
    await expect(saveLearningDraft(owner, { ...input, draft: { ...input.draft, productId: crypto.randomUUID() } })).rejects.toMatchObject({ code: "not_found" });
    await expect(saveLearningDraft(owner, { ...input, draft: { ...input.draft, conflicts: [{ guideId: crypto.randomUUID(), resolution: "", reason: "" }] } })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveLearningDraft(owner, { ...input, draft: { ...input.draft, findingIndex: 5 } })).rejects.toMatchObject({ code: "invalid" });
  });
  it("preserves drafts when deferred and blocks old publication after a save", async () => {
    const { input } = await prepare(); await saveLearningDraft(owner, input);
    await expect(publishLearningFinding(owner, approve(input, 1))).rejects.toMatchObject({ code: "conflict" });
    await decideLearningReview(owner, { id: input.reviewId, expectedRevision: 2, state: "deferred" });
    expect((await learningWorkspace(owner))[0]?.review?.editedDrafts).toEqual([input.draft]);
    await expect(saveLearningDraft(owner, { ...input, expectedRevision: 3 })).rejects.toMatchObject({ code: "conflict" });
    await decideLearningReview(owner, { id: input.reviewId, expectedRevision: 3, state: "draft" });
    await publishLearningFinding(owner, approve(input, 4));
    await expect(saveLearningDraft(owner, { ...input, expectedRevision: 5 })).rejects.toMatchObject({ code: "conflict" });
  });
  it("retains work against changed source but never permits stale publication", async () => {
    const { input, review, buyer } = await prepare();
    await getDb().update(sellerQuestion).set({ answer: "Use the red door instead.", revision: 3 }).where(eq(sellerQuestion.id, review.questionId));
    await saveLearningDraft(owner, input);
    const loaded = (await learningWorkspace(owner))[0]?.review;
    expect(loaded?.stale).toBe(true); expect(loaded?.editedDrafts).toEqual([input.draft]);
    await expect(publishLearningFinding(owner, approve(input, 2))).rejects.toMatchObject({ code: "conflict" });
    expect((await readShopGuide(buyer)).sources).toEqual([]);
  });
  it("never converts private exceptions into a public draft", async () => {
    const { input, review } = await prepare();
    await getDb().update(learningReview).set({ analysis: { ...review.analysis, findings: review.analysis.findings.map(f => ({ ...f, kind: "customer_exception", proposedFact: null })) } }).where(eq(learningReview.id, review.id));
    await expect(saveLearningDraft(owner, input)).rejects.toMatchObject({ code: "invalid" });
  });
});
