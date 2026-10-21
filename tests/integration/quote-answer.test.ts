/** @fileoverview A reviewed service quote and its explicit seller answer commit together. */
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { ensureConversation } from "@/server/ai/conversation";
import { getDb } from "@/server/db/client";
import { quote, sellerQuestion } from "@/server/db/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { approveQuoteScope, proposeQuote } from "@/server/domain/quotes";
import { askSeller } from "@/server/domain/seller-questions";
import { newBuyer, quoteEachJob, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });
async function request() {
  const buyer = await newBuyer(); await ensureConversation(buyer);
  const offer = await quoteEachJob("Brake service");
  const asked = await proposeQuote(buyer, { lines: [{ offerId: offer, quantity: 1 }], buyerNote: "Front brake repair; no rear work. Tuesday deadline requested.", budgetMinor: 12500 });
  const { question } = await askSeller(buyer, { question: "Can you finish by Tuesday?", customerGoal: "Repair within USD 125 and keep Tuesday deadline separate from payment.", knownFacts: ["No rear work"] });
  const input = { quoteId: asked.id, expectedRevision: asked.revision, approvedScope: "Front brake service only; no rear work.", prices: [{ offerId: offer, unitAmountMinor: 12000 }], answer: { questionId: question.id, expectedRevision: question.revision, answer: "The price covers front work only. Tuesday completion is not confirmed; arrange drop-off after payment." } };
  return { buyer, asked, question, input, offer };
}

it("saves the exact owner answer with the reviewed quote, without payment", async () => {
  const { question, input } = await request();
  const result = await approveQuoteScope(owner, input);
  expect(result).toMatchObject({ revision: 2, status: "review_ready", totalMinor: 12000, approvedScope: input.approvedScope });
  const [saved] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
  expect(saved).toMatchObject({ state: "answered", revision: 2, answer: input.answer.answer, resumeAttempts: 0 });
  expect(await tally()).toMatchObject({ orders: 0, attempts: 0 });
});

it("rolls back the quote if the customer revised the question", async () => {
  const { buyer, asked, input } = await request();
  await askSeller(buyer, { question: "Wednesday instead of Tuesday, is that possible?", customerGoal: "Repair by Wednesday", knownFacts: [], replacePending: true });
  await expect(approveQuoteScope(owner, input)).rejects.toMatchObject({ code: "conflict" });
  expect(await getDb().select().from(quote)).toHaveLength(1);
  expect((await getDb().select().from(quote))[0]).toMatchObject({ id: asked.id, status: "seller_review" });
  expect((await getDb().select().from(sellerQuestion))[0]).toMatchObject({ state: "open", answer: null });
});

it("refuses an answer for another customer even in the same shop", async () => {
  const first = await request(); const other = await request();
  await expect(approveQuoteScope(owner, { ...first.input, answer: other.input.answer })).rejects.toMatchObject({ code: "not_found" });
  expect(await getDb().select().from(quote)).toHaveLength(2);
  expect((await getDb().select().from(sellerQuestion)).every(q => q.state === "open")).toBe(true);
});

it("proves the user owns the shop instead of trusting the supplied seller id", async () => {
  const { input } = await request(); const { answer: _, ...quoteOnly } = input;
  await expect(approveQuoteScope({ ...owner, userId: crypto.randomUUID() }, quoteOnly)).rejects.toMatchObject({ code: "not_found" });
  expect(await getDb().select().from(quote)).toHaveLength(1);
});

it("allows only one concurrent combined decision", async () => {
  const { input } = await request();
  const result = await Promise.allSettled([approveQuoteScope(owner, input), approveQuoteScope(owner, input)]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(await getDb().select().from(quote)).toHaveLength(2);
  expect((await getDb().select().from(sellerQuestion))[0]).toMatchObject({ state: "answered", revision: 2 });
});

it("does not answer the question when the quote was replaced", async () => {
  const { buyer, asked, input, offer } = await request();
  await proposeQuote(buyer, { threadId: asked.threadId, lines: [{ offerId: offer, quantity: 1 }], buyerNote: "Different work now" });
  await expect(approveQuoteScope(owner, input)).rejects.toMatchObject({ code: "conflict" });
  expect((await getDb().select().from(sellerQuestion))[0]).toMatchObject({ state: "open", answer: null });
  expect(await getDb().select().from(quote)).toHaveLength(2);
});

it("leaves the question open when the owner submits only a quote", async () => {
  const { input } = await request(); const { answer: _, ...quoteOnly } = input;
  await approveQuoteScope(owner, quoteOnly);
  expect((await getDb().select().from(sellerQuestion))[0]).toMatchObject({ state: "open", answer: null });
});
