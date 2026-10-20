/** Real before/after buyer conversations around an explicitly approved fictional seller fact. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { ensureConversation } from "../../src/server/ai/conversation";
import { draftLearningReview } from "../../src/server/ai/learning-review";
import { publishLearningFinding } from "../../src/server/domain/learning-publication";
import type { OwnerPrincipal } from "../../src/server/domain/principal";
import { answerQuestion, latestQuestion } from "../../src/server/domain/seller-questions";
import { readShopGuide } from "../../src/server/domain/shop-guide";
import { newBuyer, tally } from "../../tests/support/shop";
import { evaluateBuyerTurn } from "./buyer-turn";

/** Tests privacy before publication and useful reuse after it; all assistant replies and review findings are real. */
export async function evaluateLearningJourney(owner: OwnerPrincipal, out: string) {
  const before = await tally();
  const prompt = "Is pickup wheelchair accessible? I need a step-free entrance. If you don't know, please ask the shop.";
  const ask = async (name: string) => {
    const buyer = await newBuyer();
    const conversationId = await ensureConversation(buyer);
    const result = await evaluateBuyerTurn({ token: buyer.token, conversationId, prompt,
      record: evidence => writeFile(`${out}/${name}.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 }) });
    return { buyer, result, question: await latestQuestion(buyer) };
  };
  const first = await ask("before-answer");
  assert.equal(first.question?.state, "open", "Unknown accessibility question was not saved for the seller");
  assert(first.question);
  const answer = "All customers can use our step-free side entrance during normal pickup hours. For Isabel's order only, I can wait until 18:00 this Friday; that is a private exception, not our normal hours.";
  await answerQuestion(owner, { questionId: first.question.id, expectedRevision: first.question.revision, answer });
  const review = await draftLearningReview(owner, first.question.id);
  await writeFile(`${out}/review.json`, JSON.stringify({ actor: "fictional seller answering the first customer", answer, review }, null, 2), { mode: 0o600 });
  const findingIndex = review.analysis.findings.findIndex(finding => finding.kind === "reusable_fact" && Boolean(finding.proposedFact));
  assert(findingIndex >= 0, "Actual review failed to identify the reusable accessibility fact");
  assert(review.analysis.findings.some(finding => finding.kind === "customer_exception" && finding.proposedFact === null), "Private exception was not kept separate");
  const unpublished = await ask("before-publication");
  assert.equal(unpublished.question?.state, "open", "A different buyer used a private seller answer before publication");
  assert.equal((await readShopGuide(unpublished.buyer)).sources.length, 0);
  const body = "All customers can use the shop's step-free side entrance during normal pickup hours.";
  const published = await publishLearningFinding(owner, { reviewId: review.id, expectedRevision: review.revision, findingIndex,
    title: "Step-free pickup entrance", body, topic: "general", productId: null, validUntil: null,
    confirmReusable: true,
    // The review may ask the seller to confirm a detail first; the fictional seller answers like a real one would.
    clarification: review.analysis.findings[findingIndex]!.questions.length ? "Yes. Normal pickup hours are the published ones: Tuesday to Saturday, 10:00 to 17:00." : "",
    conflicts: [] });
  await writeFile(`${out}/publication.json`, JSON.stringify({ actor: "explicit fictional seller publication approval", body, published }, null, 2), { mode: 0o600 });
  const next = await ask("after-publication");
  assert.equal(next.question, undefined, "The assistant asked the seller again despite the approved answer");
  const sources = await readShopGuide(next.buyer);
  assert.equal(sources.sources.length, 1);
  assert.equal(sources.sources[0]?.body, body);
  assert.match(next.result.reply, /step.free/i);
  assert.match(next.result.reply, /side entrance/i);
  assert.doesNotMatch(next.result.reply, /Isabel|18:00|6\s*(?:pm|p\.m)/i, "Private customer exception leaked into the next reply");
  assert.deepEqual(await tally(), before, "Knowledge review changed purchases");
  return { firstConversation: first.question.conversationId, publishedGuideId: published.guideId,
    checks: ["unknown question saved", "actual AI review separates public fact and private exception", "no reuse before seller publication", "next buyer answered without another handoff", "private exception not exposed", "commerce unchanged"],
    humanReview: "pending", response: next.result.reply };
}
