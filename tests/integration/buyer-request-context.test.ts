/** Saved request constraints survive the recent-message window without leaking across buyers. */
import { beforeEach, describe, expect, it } from "vitest";
import { buyerState, buyerTools } from "@/server/ai/buyer-tools";
import { ensureConversation, loadMessages, saveMessages } from "@/server/ai/conversation";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import { getSeller } from "@/server/domain/seller";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop } from "../support/shop";

const request = { question: "Can you accommodate this repair?", customerGoal: "Repair the rear hydraulic brake for the charity ride", knownFacts: ["Maximum total USD 147", "Drop off Thursday after 16:00", "Ready Friday by 17:00"] };
const options = { toolCallId: "read-request", messages: [], context: {} };
let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

describe("durable buyer request context", () => {
  it("retains all saved constraints when their original message falls outside recent history", async () => {
    const buyer = await newBuyer();
    const id = await ensureConversation(buyer);
    await saveMessages(id, [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: JSON.stringify(request) }] }]);
    await askSeller(buyer, request);
    for (let i = 0; i < 41; i++) await saveMessages(id, [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: `Unrelated browsing note ${i}` }] }]);
    const history = await loadMessages(id);
    expect(history).toHaveLength(40);
    expect(JSON.stringify(history.map(m => m.parts))).not.toContain(request.customerGoal);
    const state = await buyerState(buyer);
    for (const fact of [request.customerGoal, ...request.knownFacts]) expect(state).toContain(fact);
  });

  it("reads the corrected facts with the seller answer, without presenting them as approval", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    await askSeller(buyer, request);
    const corrected = { ...request, knownFacts: ["Maximum total USD 92", ...request.knownFacts.slice(1)], replacePending: true };
    const { question } = await askSeller(buyer, corrected);
    const shop = (await getSeller())!;
    const tool = buyerTools(buyer, shop).check_seller_answer;
    expect(await tool.execute!({}, options)).toMatchObject({ state: "waiting", customerGoal: request.customerGoal, knownFacts: corrected.knownFacts, answer: null, quoteReview: null });
    expect(await buyerState(buyer)).not.toContain("USD 147");
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "The requested deadline is unavailable." });
    expect(await tool.execute!({}, options)).toMatchObject({ state: "answered", customerGoal: request.customerGoal, knownFacts: corrected.knownFacts, answer: "The requested deadline is unavailable.", quoteReview: null });
  });

  it("does not expose saved constraints to another buyer or shop", async () => {
    const buyer = await newBuyer();
    await ensureConversation(buyer);
    await askSeller(buyer, request);
    const shop = (await getSeller())!;
    for (const stranger of [await newBuyer(), { ...buyer, sellerId: crypto.randomUUID() }]) {
      expect(await buyerState(stranger)).not.toContain(request.customerGoal);
      expect(await buyerTools(stranger, shop).check_seller_answer.execute!({}, options)).toMatchObject({ state: "none", quoteReview: null });
    }
  });
});
