/** The Desk counts answers the owner gave that were never reviewed for reuse. Analysis here is a contract fixture, not model output. */
import { beforeEach, expect, it } from "vitest";
import { ensureConversation } from "@/server/ai/conversation";
import { claimLearningReview, learningSource, saveLearningReview } from "@/server/domain/learning-review";
import { answersToTeach } from "@/server/domain/learning-review";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import { newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

async function answered(text: string) {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: text, customerGoal: "Visit the shop", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes, the side entrance is step-free." });
  return question.id;
}

it("counts answered questions until they are reviewed", async () => {
  expect(await answersToTeach(owner)).toBe(0);
  const first = await answered("Is there a way in without steps?");
  await answered("Can I bring my dog inside?");
  expect(await answersToTeach(owner)).toBe(2);
  const source = await learningSource(owner, first);
  const claim = await claimLearningReview(owner, source);
  if (claim.state !== "claimed") throw new Error("expected a fresh claim");
  await saveLearningReview(owner, source, { summary: "Nothing reusable.", findings: [] }, "synthetic-contract-fixture", claim.claim);
  expect(await answersToTeach(owner)).toBe(1);
});

it("does not count questions still waiting for the owner", async () => {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  await askSeller(buyer, { question: "Do you open on Sunday?", customerGoal: "Visit", knownFacts: [] });
  expect(await answersToTeach(owner)).toBe(0);
});
