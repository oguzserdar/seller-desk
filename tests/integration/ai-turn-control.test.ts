/**
 * @fileoverview Concurrent buyer turns and seller continuations share one execution slot
 * and one shop budget. Provider calls are delayed or refused, never scripted replies.
 * @module tests/integration/ai-turn-control
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/buyer/chat/route";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import { resumeAfterAnswer } from "@/server/ai/resume";
import { claimTurn, completeTurn, releaseTurn } from "@/server/ai/turn-control";
import { getDb } from "@/server/db/client";
import { conversation, seller, sellerQuestion } from "@/server/db/schema";
import { answerQuestion, askSeller, claimResume, completeResume, deferResume, dueResumes, releaseResume } from "@/server/domain/seller-questions";
import { consumeUsage } from "@/server/domain/usage";
import { resetServerConfigForTests } from "@/server/env";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => {
  ({ owner } = await resetShop());
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("AI_MODEL_ID", "test-model-never-sent");
  vi.stubEnv("OPENAI_API_KEY", "test-key-never-sent");
  resetServerConfigForTests();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServerConfigForTests(); });

function request(token: string, id = crypto.randomUUID()) {
  return new Request("http://localhost:4310/api/buyer/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: { id, role: "user", parts: [{ type: "text", text: "What can I buy?" }] } }) });
}
function refused() { return new Response(JSON.stringify({ error: { message: "refused locally" } }), { status: 401, headers: { "content-type": "application/json" } }); }
function holdProvider() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn(async () => { await pending; return refused(); });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, release };
}
async function questionFor(buyer: Awaited<ReturnType<typeof newBuyer>>) {
  await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Is Friday possible?", customerGoal: "Collect Friday", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Monday is the earliest." });
  return question;
}

describe("AI turn control", () => {
  it("does not claim a continuation or contact the model after recovery was cancelled", async () => {
    const question = await questionFor(await newBuyer());
    const fetcher = vi.fn(async () => refused());
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeAfterAnswer(question.id, AbortSignal.abort())).toBe("skipped");
    expect(fetcher).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: 0, resumeClaimId: null });
  });

  it("aborts an in-flight continuation without saving a completed reply or retaining its claim", async () => {
    const buyer = await newBuyer();
    const question = await questionFor(buyer);
    const controller = new AbortController();
    let seenSignal: AbortSignal | null | undefined;
    let release!: () => void;
    const fetcher = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      seenSignal = init?.signal;
      release = () => reject(new DOMException("Stopped in test", "AbortError"));
      if (seenSignal?.aborted) release(); else seenSignal?.addEventListener("abort", release, { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = resumeAfterAnswer(question.id, controller.signal);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      controller.abort();
      expect(seenSignal?.aborted).toBe(true);
      expect(await pending).toBe("failed");
    } finally { release?.(); await pending; }
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: 1, resumeClaimId: null });
    expect(await loadMessages(question.conversationId)).toEqual([]);
    const claim = await claimTurn(buyer, question.conversationId);
    expect(claim).toBeDefined();
    if (claim) await releaseTurn(claim);
  });

  it("never reuses a deferred continuation's ownership even when its retry count is unchanged", async () => {
    const question = await questionFor(await newBuyer());
    const old = (await claimResume(question.id))!;
    await deferResume(old, new Date(0));
    const replacement = (await claimResume(question.id))!;
    expect(replacement.resumeAttempts).toBe(old.resumeAttempts);
    expect(await completeResume(old)).toBe(false);
    await releaseResume(old, "late old failure");
    expect(await completeResume(replacement)).toBe(true);
  });

  it("rejects another buyer and fences an expired worker from a replacement turn", async () => {
    const buyer = await newBuyer();
    const other = await newBuyer();
    const conversationId = await ensureConversation(buyer);
    expect(await claimTurn(other, conversationId)).toBeUndefined();
    const old = (await claimTurn(buyer, conversationId))!;
    expect(await claimTurn(buyer, conversationId)).toBeUndefined();
    await getDb().update(conversation).set({ activeTurnExpiresAt: sql`now() - interval '1 second'` }).where(eq(conversation.id, conversationId));
    const replacement = (await claimTurn(buyer, conversationId))!;
    expect(replacement.id).not.toBe(old.id);
    await expect(completeTurn(old, [{ id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: "stale" }] }])).rejects.toThrow("expired or was replaced");
    await releaseTurn(old);
    expect(await claimTurn(buyer, conversationId)).toBeUndefined();
    await completeTurn(replacement, []);
    expect(await loadMessages(conversationId)).toEqual([]);
    expect(await claimTurn(buyer, conversationId)).toBeDefined();
  });

  it("refuses overlapping buyer turns before storing the second message or spending another model call", async () => {
    const buyer = await newBuyer();
    const held = holdProvider();
    const first = await POST(request(buyer.token));
    const firstBody = first.text();
    await vi.waitFor(() => expect(held.fetcher).toHaveBeenCalledOnce());
    let status: number;
    let secondBody: Promise<string> | undefined;
    try {
      const second = await POST(request(buyer.token));
      status = second.status;
      secondBody = second.text();
    } finally { held.release(); await firstBody; await secondBody; }
    expect(status!).toBe(409);
    expect(held.fetcher).toHaveBeenCalledOnce();
    const history = await loadMessages(await ensureConversation(buyer));
    expect(history.filter(m => m.role === "user")).toHaveLength(1);
    const retry = await POST(request(buyer.token));
    await retry.text();
    expect(retry.status).toBe(200);
  });

  it("defers a seller continuation while the buyer's existing turn is running", async () => {
    const buyer = await newBuyer();
    const question = await questionFor(buyer);
    const held = holdProvider();
    const first = await POST(request(buyer.token));
    const firstBody = first.text();
    await vi.waitFor(() => expect(held.fetcher).toHaveBeenCalledOnce());
    let outcome: string;
    try {
      let settled = false;
      const resume = resumeAfterAnswer(question.id).then(result => { settled = true; return result; });
      // Release only once the continuation has either skipped or tried another provider request.
      await vi.waitFor(() => expect(settled || held.fetcher.mock.calls.length >= 2).toBe(true));
      held.release();
      outcome = await resume;
    } finally { held.release(); await firstBody; }
    expect(outcome!).toBe("skipped");
    expect(held.fetcher).toHaveBeenCalledOnce();
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: 0 });
  });

  it("defers budget-exhausted continuations without calling the model or consuming a retry", async () => {
    const buyer = await newBuyer();
    const question = await questionFor(buyer);
    await getDb().update(seller).set({ sellerDailyAiTurns: 1 }).where(eq(seller.id, owner.sellerId));
    await consumeUsage("seller_ai_day", owner.sellerId, 86_400, 1);
    const fetcher = vi.fn(async () => refused());
    vi.stubGlobal("fetch", fetcher);
    expect(await resumeAfterAnswer(question.id)).toBe("skipped");
    expect(fetcher).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
    expect(row).toMatchObject({ state: "answered", resumeAttempts: 0 });
    expect(await dueResumes(10)).not.toContain(question.id);
  });
});
