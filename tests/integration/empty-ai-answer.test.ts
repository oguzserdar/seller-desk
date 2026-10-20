/** @fileoverview Empty and token-limited provider streams are failures, never scripted successful replies. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { POST as ownerPost } from "@/app/api/owner/chat/route";
import { getAuth } from "@/server/auth/auth";
import { FIXTURE_OWNER_EMAIL } from "@/fixtures/seed";
import { loadOwnerHistory } from "@/server/ai/owner-conversation";
import { POST } from "@/app/api/buyer/chat/route";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import { resumeAfterAnswer } from "@/server/ai/resume";
import { getDb } from "@/server/db/client";
import { conversation, sellerQuestion } from "@/server/db/schema";
import { askSeller, answerQuestion } from "@/server/domain/seller-questions";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { resetServerConfigForTests } from "@/server/env";
import { newBuyer, resetShop, tally, TEST_OWNER_PASSWORD } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => {
  ({ owner } = await resetShop());
  vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL_ID", "test-no-answer"); vi.stubEnv("OPENAI_API_KEY", "test-key-never-sent"); resetServerConfigForTests();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetServerConfigForTests(); });

function noAnswer(reason: "stop" | "length") {
  // Provider failure fixture: no generated answer, tool success or other successful assistant output.
  vi.stubGlobal("fetch", vi.fn(async () => new Response([
    { type: "response.created", response: { id: "no-answer", created_at: 0, model: "test-no-answer" } },
    { type: reason === "length" ? "response.incomplete" : "response.completed", response: { incomplete_details: reason === "length" ? { reason: "max_output_tokens" } : null, usage: { input_tokens: 1, output_tokens: 1500, output_tokens_details: { reasoning_tokens: 1500 } } } },
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })));
}

it.each(["stop", "length"] as const)("shows a failure for an empty %s stream and keeps the buyer message for recovery", async reason => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer); const before = await tally(); noAnswer(reason);
  const response = await POST(new Request("http://localhost:4310/api/buyer/chat", { method: "POST", headers: { Authorization: `Bearer ${buyer.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Did my payment work?" }] } }) }));
  const body = await response.text();
  expect(body).toContain('"type":"error"');
  expect(body).toContain("The assistant could not finish");
  expect((await loadMessages(id)).map(m => m.role)).toEqual(["user"]);
  expect((await getDb().select().from(conversation).where(eq(conversation.id, id)))[0]?.activeTurnId).toBeNull();
  expect(await tally()).toEqual(before);
});

it.each(["stop", "length"] as const)("does not mark a seller continuation delivered after an empty %s stream", async reason => {
  const buyer = await newBuyer(); const id = await ensureConversation(buyer);
  const { question } = await askSeller(buyer, { question: "Which entrance can I use?", customerGoal: "Find the shop", knownFacts: [] });
  await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Use the blue door." });
  noAnswer(reason);
  expect(await resumeAfterAnswer(question.id)).toBe("failed");
  const [row] = await getDb().select().from(sellerQuestion).where(eq(sellerQuestion.id, question.id));
  expect(row).toMatchObject({ state: "answered", answer: "Use the blue door.", resumeAttempts: 1 });
  expect(row?.resumeError).toBeTruthy();
  expect(await loadMessages(id)).toEqual([]);
  expect((await getDb().select().from(conversation).where(eq(conversation.id, id)))[0]?.activeTurnId).toBeNull();
});

it.each(["stop", "length"] as const)("keeps owner recovery available after an empty %s stream", async reason => {
  const login = await getAuth().handler(new Request("http://localhost:4310/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:4310" }, body: JSON.stringify({ email: FIXTURE_OWNER_EMAIL, password: TEST_OWNER_PASSWORD }) }));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  noAnswer(reason);
  const response = await ownerPost(new Request("http://localhost:4310/api/owner/chat", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Which orders need my help?" }] } }) }));
  expect(await response.text()).toContain('"type":"error"');
  const history = await loadOwnerHistory(owner);
  expect(history.messages.map(m => m.role)).toEqual(["user"]);
  expect(history).toMatchObject({ busyUntil: null, interrupted: true });
});
