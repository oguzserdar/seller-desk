/**
 * @fileoverview Regression tests for failed continuations, exhausted leases,
 * unsupported extracted values, partial imports, and bounded chat history.
 * @module tests/integration/ai-redteam
 * Model requests are refused locally. These tests never generate demo replies.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureConversation, loadMessages, saveMessages } from "@/server/ai/conversation";
import { addDraftedOffers, buildDrafts, type ExtractionResult } from "@/server/ai/draft-setup";
import { resumeAfterAnswer } from "@/server/ai/resume";
import { getDb } from "@/server/db/client";
import { importDraft, message, offer, sellerQuestion } from "@/server/db/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getSeller } from "@/server/domain/seller";
import { answerQuestion, askSeller, claimResume, dueResumes, waitingQuestion } from "@/server/domain/seller-questions";
import { resetServerConfigForTests } from "@/server/env";
import { newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;

beforeEach(async () => { ({ owner } = await resetShop()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServerConfigForTests(); });

async function answeredQuestion() {
  const buyer = await newBuyer();
  const conversationId = await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Can you finish by Friday?", customerGoal: "Collect before the weekend", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Yes, collect Friday after 4pm." });
  return { buyer, question, conversationId };
}

function extracted(overrides: Partial<ExtractionResult["offers"][number]> = {}): ExtractionResult {
  return { offers: [{ title: "Notebook", titleQuote: "Notebook", kind: "goods", priceQuote: "$10", stockQuote: null, descriptionQuote: null, scopeQuote: null, ...overrides }], missing: [] };
}

describe("9 October AI red-team regressions", () => {
  it("records a refused model continuation as failed and schedules a retry", async () => {
    const { question, conversationId } = await answeredQuestion();
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL_ID", "test-model-never-sent");
    vi.stubEnv("OPENAI_API_KEY", "test-key-never-sent");
    resetServerConfigForTests();
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "refused locally" } }), { status: 401, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", refused);
    expect(await resumeAfterAnswer(question.id)).toBe("failed");
    expect(refused).toHaveBeenCalled();
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: 1 });
    expect(row?.resumeError).toBeTruthy();
    expect(await dueResumes(10)).toContain(question.id);
    expect(await loadMessages(conversationId)).toEqual([]);
  });

  it("closes an exhausted expired lease rather than leaving the buyer waiting forever", async () => {
    const { buyer, question } = await answeredQuestion();
    for (let i = 0; i < 3; i++) {
      expect(await claimResume(question.id)).toBeDefined();
      await getDb().update(sellerQuestion).set({ resumedAt: sql`now() - interval '3 minutes'` }).where(eq(sellerQuestion.id, question.id));
    }
    expect(await dueResumes(10)).not.toContain(question.id);
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "closed", resumeAttempts: 3 });
    expect(row?.resumeError).toBeTruthy();
    expect(await waitingQuestion(buyer)).toBeUndefined();
  });

  it("uses the actual quoted title, never an unsupported model title", () => {
    const [draft] = buildDrafts("Notebook costs $10.", extracted({ title: "Lifetime unlimited warranty" }), "USD");
    expect(draft?.title).toMatchObject({ value: "Notebook", status: "grounded" });
  });

  it("rejects price and stock quotes containing unrelated numbers", () => {
    const [draft] = buildDrafts("Notebook costs $10. A 2-pack costs $50; 8 available.", extracted({ priceQuote: "2-pack costs $50", stockQuote: "2-pack costs $50; 8 available" }), "USD");
    expect(draft?.priceMinor).toMatchObject({ value: null, status: "unknown" });
    expect(draft?.stock).toMatchObject({ value: null, status: "unknown" });
    expect(draft?.include).toBe(false);
  });

  it("rolls back every offer and the import claim when a selected draft is invalid", async () => {
    const shop = await getSeller();
    if (!shop) throw new Error("shop missing");
    const drafts = buildDrafts("Notebook $10. Sticker $5; 100001 in stock.", { offers: [...extracted().offers, ...extracted({ title: "Sticker", titleQuote: "Sticker", priceQuote: "$5", stockQuote: "100001 in stock" }).offers], missing: [] }, "USD");
    // A stale or corrupt stored draft must also be rejected atomically.
    drafts[1]!.stock = { value: 100001, status: "grounded", evidence: { quote: "100001 in stock", start: 23, end: 38 } };
    const [row] = await getDb().insert(importDraft).values({ sellerId: shop.id, sourceKind: "paste", sourceText: "test", sourceHash: "test", proposed: drafts, generator: "test:boundary" }).returning();
    if (!row) throw new Error("draft missing");
    const choices = drafts.map(d => ({ key: d.key, include: true, kind: "goods" as const }));
    const input = { draftId: row.id, reviewRevision: row.reviewRevision, choices };
    await expect(addDraftedOffers(owner, shop, input)).rejects.toThrow();
    const [after] = await getDb().select().from(importDraft).where(eq(importDraft.id, row.id));
    expect(after).toMatchObject({ status: "draft", reviewRevision: row.reviewRevision });
    expect(await getDb().select().from(offer).where(eq(offer.title, "Notebook"))).toHaveLength(0);
    expect(await addDraftedOffers(owner, shop, { ...input, choices: [{ ...choices[0]!, include: true }] })).toEqual({ created: 1, skipped: 1 });
  });

  it("loads the newest whole messages after a conversation passes 500 entries", async () => {
    const conversationId = await ensureConversation(await newBuyer());
    await getDb().insert(message).values(Array.from({ length: 501 }, (_, i) => ({ id: `history-${String(i + 1).padStart(4, "0")}`, conversationId, role: "user" as const, parts: [{ type: "text" as const, text: `Message ${i + 1}` }], createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000) })));
    const messages = await loadMessages(conversationId);
    expect(messages).toHaveLength(40);
    expect(messages[0]?.id).toBe("history-0462");
    expect(messages.at(-1)?.id).toBe("history-0501");
  });

  it("preserves input order when one save gives every message the same timestamp", async () => {
    const conversationId = await ensureConversation(await newBuyer());
    const messages = Array.from({ length: 45 }, (_, i) => ({ id: `same-time-${45 - i}`, role: i % 2 ? "assistant" as const : "user" as const, parts: [{ type: "text" as const, text: String(i) }] }));
    await saveMessages(conversationId, messages);
    expect((await loadMessages(conversationId)).map(m => m.id)).toEqual(messages.slice(-40).map(m => m.id));
  });
});
