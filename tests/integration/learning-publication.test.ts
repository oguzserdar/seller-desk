/** @fileoverview Publication contracts over actual PostgreSQL; analysis fixtures are not real-model evidence. */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { LearningAnalysis } from "@/lib/learning-review";
import type { PublishLearningInput } from "@/lib/learning-publication";
import { ensureConversation } from "@/server/ai/conversation";
import { getDb } from "@/server/db/client";
import { learningPublication, learningReview, seller, sellerQuestion } from "@/server/db/schema";
import { askSeller, answerQuestion } from "@/server/domain/seller-questions";
import { claimLearningReview, learningSource, learningWorkspace, saveLearningReview, decideLearningReview } from "@/server/domain/learning-review";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import { guideHistory, readShopGuide, removeGuide, saveGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, offerId, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const answer = "For Jo only, pickup at 8pm is fine. Normal pickup ends at 6pm Edmonton time. Bring your receipt for collection.";
async function prepare(conflictIds: string[] = [], kind: LearningAnalysis["findings"][number]["kind"] = "reusable_fact") {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Can Jo collect at 8pm?", customerGoal: "Collect after work", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer });
  const source = await learningSource(owner, question.id);
  const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("expected fresh claim");
  const finding = { kind, title: "Pickup hours", explanation: "General hours separate from one exception.", answerQuote: "Normal pickup ends at 6pm Edmonton time.", proposedFact: kind === "reusable_fact" || kind === "product_rule" ? "Pickup ends at 6pm Edmonton time." : null, scope: "Pickups", questions: [], conflictingPolicyFields: [], conflictingProductIds: [], conflictingGuideIds: conflictIds };
  const review = await saveLearningReview(owner, source, { summary: "Two reusable facts.", findings: [finding, { ...finding, kind: "reusable_fact", title: "Collection receipt", answerQuote: "Bring your receipt for collection.", proposedFact: "Bring your receipt for collection.", conflictingPolicyFields: [], conflictingProductIds: [], conflictingGuideIds: [] }] }, "synthetic-contract-fixture", claim.claim);
  const input: PublishLearningInput = { reviewId: review.id, expectedRevision: review.revision, findingIndex: 0, title: "Pickup hours", body: "Normal pickup ends at 6pm Edmonton time.", topic: "general", productId: null, validUntil: null, confirmReusable: true, clarification: "", conflicts: [] };
  return { buyer, review, input };
}

describe("approved learning publication", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  it("publishes only edited public wording, retains private provenance and leaves commerce alone", async () => {
    const { buyer, input } = await prepare(); const before = await tally();
    const published = await publishLearningFinding(owner, { ...input, body: "Please collect before 6pm, Edmonton local time." });
    const publicFacts = await readShopGuide(buyer);
    expect(publicFacts.sources).toHaveLength(1);
    expect(publicFacts.sources[0]?.body).toBe("Please collect before 6pm, Edmonton local time.");
    expect(JSON.stringify(publicFacts)).not.toMatch(/Jo|8pm|customerGoal|answerQuote|reviewId/);
    expect((await guideHistory(owner, published.guideId))[0]?.snapshot.published).toBe(true);
    expect(await tally()).toEqual(before);
  });
  it("deduplicates concurrent approval, rejects changed replay and never resurrects removed knowledge", async () => {
    const { buyer, input } = await prepare();
    const [a, b] = await Promise.all([publishLearningFinding(owner, input), publishLearningFinding(owner, input)]);
    expect(a.id).toBe(b.id);
    expect(await getDb().select().from(learningPublication)).toHaveLength(1);
    await expect(publishLearningFinding(owner, { ...input, body: "Changed wording after approval." })).rejects.toMatchObject({ code: "conflict" });
    await removeGuide(owner, a.guideId, a.guideRevision);
    expect((await publishLearningFinding(owner, input)).id).toBe(a.id);
    expect((await readShopGuide(buyer)).sources).toEqual([]);
  });
  it("allows another finding from the same review but refuses unrelated knowledge changes", async () => {
    const { input } = await prepare(); await publishLearningFinding(owner, input);
    expect((await learningWorkspace(owner))[0]?.review?.stale).toBe(false);
    await publishLearningFinding(owner, { ...input, expectedRevision: 2, findingIndex: 1, title: "Bring a receipt", body: "Bring your receipt for collection." });
    expect((await learningWorkspace(owner))[0]?.review?.stale).toBe(false);
    const next = await prepare();
    await saveGuide(owner, { title: "Shop address", body: "Collection is at our downtown shop.", topic: "general", published: true, productId: null, validUntil: null, actionLabel: "", actionUrl: "" });
    await expect(publishLearningFinding(owner, next.input)).rejects.toMatchObject({ code: "conflict" });
  });
  it("requires owner, current source, active review and explicit reusable confirmation", async () => {
    const { input, review } = await prepare();
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) await expect(publishLearningFinding(caller, input)).rejects.toMatchObject({ code: "not_found" });
    await expect(publishLearningFinding(owner, { ...input, confirmReusable: false } as unknown as PublishLearningInput)).rejects.toThrow();
    await decideLearningReview(owner, { id: review.id, expectedRevision: 1, state: "rejected" });
    await expect(publishLearningFinding(owner, { ...input, expectedRevision: 2 })).rejects.toMatchObject({ code: "conflict" });
    const next = await prepare();
    await getDb().update(sellerQuestion).set({ answer: "Pickup is unavailable.", revision: 3 }).where(eq(sellerQuestion.id, next.review.questionId));
    await expect(publishLearningFinding(owner, next.input)).rejects.toMatchObject({ code: "conflict" });
    expect(await getDb().select().from(learningPublication)).toEqual([]);
  });
  it("blocks private exceptions and requires product scope or future expiry when applicable", async () => {
    for (const kind of ["customer_exception", "missing_integration", "app_failure", "unclear"] as const) {
      const { input } = await prepare([], kind);
      await expect(publishLearningFinding(owner, input)).rejects.toMatchObject({ code: "invalid" });
    }
    const product = await prepare([], "product_rule");
    await expect(publishLearningFinding(owner, product.input)).rejects.toMatchObject({ code: "invalid" });
    await expect(publishLearningFinding(owner, { ...product.input, productId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    const id = await offerId("Disc brake pads"); await publishLearningFinding(owner, { ...product.input, productId: id });
    expect((await readShopGuide(product.buyer)).sources).toEqual([]);
    expect((await readShopGuide(product.buyer, id)).sources).toHaveLength(1);
    const temporary = await prepare([], "temporary_information");
    await expect(publishLearningFinding(owner, temporary.input)).rejects.toMatchObject({ code: "invalid" });
    await expect(publishLearningFinding(owner, { ...temporary.input, validUntil: "2020-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "invalid" });
    await publishLearningFinding(owner, { ...temporary.input, validUntil: "2099-01-01T00:00:00Z" });
  });
  it("requires an explicit conflict resolution and preserves the replaced rule's history", async () => {
    const guide = await saveGuide(owner, { title: "Old hours", body: "Pickup ends at 5pm Edmonton time.", topic: "general", published: true, productId: null, validUntil: null, actionLabel: "Directions", actionUrl: "https://example.com/directions" });
    const { buyer, input } = await prepare([guide.id]);
    await expect(publishLearningFinding(owner, input)).rejects.toMatchObject({ code: "invalid" });
    const result = await publishLearningFinding(owner, { ...input, conflicts: [{ guideId: guide.id, resolution: "replace", reason: "Hours changed permanently." }] });
    expect(result).toMatchObject({ guideId: guide.id, guideRevision: 2 });
    expect((await readShopGuide(buyer)).sources).toHaveLength(1);
    expect(await guideHistory(owner, guide.id)).toHaveLength(2);
    expect((await guideHistory(owner, guide.id))[0]?.snapshot.actionUrl).toBe("https://example.com/directions");
  });
  it("requires a fresh review when an earlier publication changed a remaining finding's conflict", async () => {
    const guide = await saveGuide(owner, { title: "Old hours", body: "Pickup ends at 5pm Edmonton time.", topic: "general", published: true, productId: null, validUntil: null, actionLabel: "", actionUrl: "" });
    const { input, review } = await prepare([guide.id]);
    const analysis = { ...review.analysis, findings: review.analysis.findings.map(finding => ({ ...finding, conflictingGuideIds: [guide.id] })) };
    await getDb().update(learningReview).set({ analysis }).where(eq(learningReview.id, review.id));
    await publishLearningFinding(owner, { ...input, conflicts: [{ guideId: guide.id, resolution: "replace", reason: "Hours changed permanently." }] });
    expect((await learningWorkspace(owner))[0]?.review?.stale).toBe(true);
    await expect(publishLearningFinding(owner, { ...input, expectedRevision: 2, findingIndex: 1, conflicts: [{ guideId: guide.id, resolution: "replace", reason: "Based on the old conflict shown." }] })).rejects.toMatchObject({ code: "conflict" });
  });
  it("includes checkout terms and product descriptions, and invalidates approval when terms change", async () => {
    const { input, review } = await prepare();
    expect(review.source.terms.pickupPolicy).toMatch(/17:00/);
    expect(review.source.products.some(product => product.title === "Disc brake pads" && product.description.length > 0)).toBe(true);
    await getDb().update(seller).set({ pickupPolicy: "Pickup now closes at 4pm.", policyRevision: 5 }).where(eq(seller.id, owner.sellerId));
    await expect(publishLearningFinding(owner, input)).rejects.toMatchObject({ code: "conflict" });
  });
  it("cannot override checkout terms through an approved knowledge finding", async () => {
    const { input, review } = await prepare();
    const analysis = { ...review.analysis, findings: review.analysis.findings.map(finding => ({ ...finding, conflictingPolicyFields: ["pickupPolicy" as const] })) };
    await getDb().update(learningReview).set({ analysis }).where(eq(learningReview.id, review.id));
    await expect(publishLearningFinding(owner, input)).rejects.toMatchObject({ code: "invalid" });
    expect(await getDb().select().from(learningPublication)).toEqual([]);
  });
});
