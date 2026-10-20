/**
 * A seller is never asked to approve a fact the shop already publishes. Analysis
 * fixtures here are contract inputs, not real-model evidence.
 */
import { beforeEach, expect, it } from "vitest";
import type { PublishLearningInput } from "@/lib/learning-publication";
import { coveredBy, validateLearningAnalysis, type LearningAnalysis } from "@/lib/learning-review";
import { ensureConversation } from "@/server/ai/conversation";
import { getDb } from "@/server/db/client";
import { learningPublication, shopGuide } from "@/server/db/schema";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import { claimLearningReview, learningSource, saveLearningReview } from "@/server/domain/learning-review";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import { saveGuide } from "@/server/domain/shop-guide";
import { newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

const answer = "Bring your receipt for collection. Parking is free behind the shop.";
type Finding = LearningAnalysis["findings"][number];
const finding = (over: Partial<Finding> = {}): Finding => ({
  kind: "reusable_fact", title: "Collection receipt", explanation: "General collection rule.", answerQuote: "Bring your receipt for collection.",
  proposedFact: "Bring your receipt for collection.", scope: "All pickups", questions: [],
  conflictingGuideIds: [], coveredByGuideIds: [], conflictingPolicyFields: [], conflictingProductIds: [], ...over,
});

/** A published guide, then an answered seller question whose review source includes that guide. */
async function setup(guideBody: string) {
  const guide = await saveGuide(owner, { title: "Collection", body: guideBody, topic: "general", published: true, productId: null, validUntil: null, actionLabel: "", actionUrl: "" });
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Do I need anything to collect?", customerGoal: "Collect an order", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer });
  const source = await learningSource(owner, question.id);
  return { guide, source };
}

async function save(source: Awaited<ReturnType<typeof setup>>["source"], findings: Finding[]) {
  const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("expected a fresh claim");
  return saveLearningReview(owner, source, { summary: "One fact.", findings }, "synthetic-contract-fixture", claim.claim);
}

const publishInput = (reviewId: string, revision: number): PublishLearningInput => ({ reviewId, expectedRevision: revision, findingIndex: 0, title: "Collection receipt",
  body: "Bring your receipt for collection.", topic: "general", productId: null, validUntil: null, confirmReusable: true, clarification: "", conflicts: [] });

it("a word-for-word repeat of a published guide is marked covered even when the model missed it, and cannot be published again", async () => {
  const { guide, source } = await setup("bring your receipt for collection");
  const review = await save(source, [finding()]);
  expect(coveredBy(review.analysis.findings[0]!)).toEqual([guide.id]);
  const before = await tally();
  await expect(publishLearningFinding(owner, publishInput(review.id, review.revision))).rejects.toMatchObject({ code: "invalid" });
  expect(await getDb().select().from(learningPublication)).toHaveLength(0);
  expect(await getDb().select().from(shopGuide)).toHaveLength(1);
  expect(await tally()).toEqual(before);
});

it("a fact the model reports as already covered cannot be published again", async () => {
  const { guide, source } = await setup("Please have your receipt ready when you collect.");
  const review = await save(source, [finding({ coveredByGuideIds: [guide.id] })]);
  await expect(publishLearningFinding(owner, publishInput(review.id, review.revision))).rejects.toMatchObject({ code: "invalid" });
  expect(await getDb().select().from(learningPublication)).toHaveLength(0);
});

it("a new fact with different meaning is still publishable", async () => {
  const { source } = await setup("Parking is not available at the shop.");
  const review = await save(source, [finding()]);
  expect(coveredBy(review.analysis.findings[0]!)).toEqual([]);
  await expect(publishLearningFinding(owner, publishInput(review.id, review.revision))).resolves.toMatchObject({ findingIndex: 0 });
});

it("rejects coverage claims outside the snapshot or that also call the guide a conflict", async () => {
  const { guide, source } = await setup("Please have your receipt ready when you collect.");
  const analysis = (over: Partial<Finding>) => ({ summary: "x", findings: [finding(over)] });
  expect(() => validateLearningAnalysis(source, analysis({ coveredByGuideIds: [crypto.randomUUID()] }))).toThrow(/outside its source snapshot/);
  expect(() => validateLearningAnalysis(source, analysis({ coveredByGuideIds: [guide.id], conflictingGuideIds: [guide.id] }))).toThrow(/both the same fact and a conflict/);
});

it("reviews saved before coverage existed read as covering nothing", () => {
  const { coveredByGuideIds: _omitted, ...legacy } = finding();
  expect(coveredBy(legacy as Finding)).toEqual([]);
});
