import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/buyer/chat/route";
import { ensureConversation, loadMessages, saveMessages } from "@/server/ai/conversation";
import { claimTurn, completeTurn, releaseTurn } from "@/server/ai/turn-control";
import { resumeAfterAnswer } from "@/server/ai/resume";
import { getDb } from "@/server/db/client";
import { auditEvent } from "@/server/db/schema";
import { changeConversationHandler, readBuyerConversationControl, readOwnerConversationControl } from "@/server/domain/conversation-control";
import { answerQuestion, askSeller, claimResume, dueResumes } from "@/server/domain/seller-questions";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { resetServerConfigForTests } from "@/server/env";
import { newBuyer, quoteFor, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServerConfigForTests(); });
describe("durable conversation ownership", () => {
  it("preserves customer history and commerce while switching control", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    await saveMessages(id, [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Please let the shop owner help me." }] }]);
    await quoteFor(buyer, "Disc brake pads"); const before = await tally(); const messages = await loadMessages(id);
    expect(await readOwnerConversationControl(owner, id)).toEqual({ id, handler: "assistant", revision: 1 });
    expect(await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" })).toEqual({ id, handler: "seller", revision: 2 });
    expect(await readBuyerConversationControl(buyer, id)).toEqual({ id, handler: "seller", revision: 2 });
    expect(await loadMessages(id)).toEqual(messages); expect(await tally()).toEqual(before);
    expect(await changeConversationHandler(owner, { id, expectedRevision: 2, handler: "assistant" })).toEqual({ id, handler: "assistant", revision: 3 });
  });

  it("revokes the current turn, prevents new turns during seller control, and never revives an old claim", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const old = (await claimTurn(buyer, id))!;
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    await expect(completeTurn(old, [])).rejects.toThrow();
    expect(await claimTurn(buyer, id)).toBeUndefined();
    await changeConversationHandler(owner, { id, expectedRevision: 2, handler: "assistant" });
    const next = (await claimTurn(buyer, id))!; expect(next.id).not.toBe(old.id);
    await releaseTurn(old); expect(await claimTurn(buyer, id)).toBeUndefined();
    await expect(completeTurn(old, [])).rejects.toThrow(); await completeTurn(next, []);
  });

  it("proves both owner identity and customer scope, and rejects stale control changes", async () => {
    const buyer = await newBuyer(); const other = await newBuyer(); const id = await ensureConversation(buyer);
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
      await expect(readOwnerConversationControl(caller, id)).rejects.toMatchObject({ code: "not_found" });
      await expect(changeConversationHandler(caller, { id, expectedRevision: 1, handler: "seller" })).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(readBuyerConversationControl(other, id)).rejects.toMatchObject({ code: "not_found" });
    const attempts = await Promise.allSettled([changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" }), changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" })]);
    expect(attempts.filter(x => x.status === "fulfilled")).toHaveLength(1);
    await expect(changeConversationHandler(owner, { id, expectedRevision: 1, handler: "assistant" })).rejects.toMatchObject({ code: "conflict" });
    const audits = await getDb().select().from(auditEvent).where(eq(auditEvent.targetId, id));
    expect(audits.filter(x => x.operation === "conversation.takeover")).toHaveLength(1);
  });

  it("keeps answered questions out of autonomous recovery until explicit handback", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const { question } = await askSeller(buyer, { question: "Can this be ready Friday?", customerGoal: "Collect Friday", knownFacts: [] });
    await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Monday is the earliest." });
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    expect(await dueResumes(20)).not.toContain(question.id);
    expect(await claimResume(question.id)).toBeUndefined();
    await changeConversationHandler(owner, { id, expectedRevision: 2, handler: "assistant" });
    expect(await dueResumes(20)).toContain(question.id);
    expect(await claimResume(question.id)).toBeDefined();
  });

  it("accepts buyer messages and skips inference/recovery while seller-controlled", async () => {
    vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL_ID", "never-sent-test-model"); vi.stubEnv("OPENAI_API_KEY", "never-sent-test-key"); resetServerConfigForTests();
    const fetcher = vi.fn(async () => new Response("Provider refused", { status: 401 })); vi.stubGlobal("fetch", fetcher);
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const { question } = await askSeller(buyer, { question: "Can this be ready Friday?", customerGoal: "Collect Friday", knownFacts: [] });
    await answerQuestion(owner, { questionId: question.id, expectedRevision: 1, answer: "Monday is the earliest." });
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    const response = await POST(new Request("http://localhost:4310/api/buyer/chat", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${buyer.token}` }, body: JSON.stringify({ message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Can you make a new quote?" }] } }) }));
    expect(response.status).toBe(200); await response.text();
    expect(await resumeAfterAnswer(question.id)).toBe("skipped");
    expect(fetcher).not.toHaveBeenCalled(); expect(await loadMessages(id)).toMatchObject([{ role: "user", parts: [{ type: "text", text: "Can you make a new quote?" }] }]);
  });
});
