/**
 * A learned fact is published only against the catalog as it is at commit time.
 * A product edit that is still in flight when publication starts must not be
 * missed. Analysis fixtures are contract inputs, not real-model evidence.
 */
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import type { PublishLearningInput } from "@/lib/learning-publication";
import type { LearningAnalysis } from "@/lib/learning-review";
import { ensureConversation } from "@/server/ai/conversation";
import { getDb, transaction } from "@/server/db/client";
import { inventory, learningPublication, offer } from "@/server/db/schema";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import { claimLearningReview, learningSource, saveLearningReview } from "@/server/domain/learning-review";
import { saveOfferInTransaction } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getSeller } from "@/server/domain/seller";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import { newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

const finding: LearningAnalysis["findings"][number] = {
  kind: "reusable_fact", title: "Collection receipt", explanation: "General collection rule.", answerQuote: "Bring your receipt for collection.",
  proposedFact: "Bring your receipt for collection.", scope: "All pickups", questions: [],
  conflictingGuideIds: [], coveredByGuideIds: [], conflictingPolicyFields: [], conflictingProductIds: [],
};

async function reviewed(): Promise<PublishLearningInput> {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Do I need anything to collect?", customerGoal: "Collect an order", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Bring your receipt for collection." });
  const source = await learningSource(owner, question.id);
  const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("expected a fresh claim");
  const review = await saveLearningReview(owner, source, { summary: "One fact.", findings: [finding] }, "synthetic-contract-fixture", claim.claim);
  return { reviewId: review.id, expectedRevision: review.revision, findingIndex: 0, title: "Collection receipt", body: "Bring your receipt for collection.",
    topic: "general", productId: null, validUntil: null, confirmReusable: true, clarification: "", conflicts: [] };
}

/** Changes the mug's description inside the caller's open transaction. */
async function editMug(tx: Parameters<typeof saveOfferInTransaction>[0], description: string) {
  const shop = await getSeller();
  const [mug] = await tx.select().from(offer).where(eq(offer.title, "Disc brake pads"));
  const [stock] = await tx.select().from(inventory).where(eq(inventory.offerId, mug!.id));
  await saveOfferInTransaction(tx, owner, shop!, { id: mug!.id, expectedRevision: mug!.revision, kind: "goods", title: mug!.title, description,
    unitAmountMinor: mug!.unitAmountMinor, fulfillmentNote: mug!.fulfillmentNote, requiresScopeReview: false, serviceScope: null, accessDays: null,
    digitalAssetId: null, maxQuantity: mug!.maxQuantity, stockTotal: stock!.total });
}

it("a product edited after the review blocks publication until the seller reviews again", async () => {
  const input = await reviewed();
  await transaction(getDb(), (tx) => editMug(tx, "Now dishwasher safe."));
  await expect(publishLearningFinding(owner, input)).rejects.toMatchObject({ code: "conflict" });
  expect(await getDb().select().from(learningPublication)).toHaveLength(0);
});

it("a product edit still in flight when publication starts is not missed", async () => {
  const input = await reviewed();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let edited!: () => void;
  const editDone = new Promise<void>((resolve) => { edited = resolve; });
  const edit = transaction(getDb(), async (tx) => { await editMug(tx, "Now dishwasher safe."); edited(); await gate; });
  await editDone; // the edit is written but not committed
  const outcome = publishLearningFinding(owner, input).then(() => "published", (error: { code?: string }) => error.code ?? "error");
  await new Promise((resolve) => setTimeout(resolve, 400)); // an unblocked publication finishes well inside this
  release(); await edit;
  expect(await outcome).toBe("conflict");
  expect(await getDb().select().from(learningPublication)).toHaveLength(0);
});
