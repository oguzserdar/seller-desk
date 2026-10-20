/** Real chat route execution for isolated evaluations, including durable history and retry checks. */
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { GET, POST } from "../../src/app/api/buyer/chat/route";
import { conversationText } from "../../src/lib/conversation-messages";
import { loadMessages } from "../../src/server/ai/conversation";

/** Saved evidence from one actual streamed reply; a failed stream is never replaced with generated prose. */
export type BuyerTurnEvidence = {
  prompt: string; latencyMs: number; status: number; stream: string;
  reply: string; messages: UIMessage[]; reloaded: boolean; retryDidNotDuplicate: boolean;
};

/**
 * Calls the production handlers directly, then compares the stored and reloaded conversation.
 * The caller must already have selected a guarded isolated database and a real model.
 * Captures partial evidence before throwing; does not launch a server or claim browser coverage.
 */
export async function evaluateBuyerTurn(input: {
  token: string; conversationId: string; prompt: string;
  record: (evidence: BuyerTurnEvidence) => Promise<void>;
}): Promise<BuyerTurnEvidence> {
  // Free AI tiers allow a few requests per minute and one turn can take several tool steps.
  // EVAL_TURN_PAUSE_MS spaces turns out; the product itself never retries a model call.
  const pause = Number(process.env.EVAL_TURN_PAUSE_MS ?? 0);
  if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  const id = crypto.randomUUID();
  const headers = { authorization: `Bearer ${input.token}`, "content-type": "application/json" };
  const request = () => new Request("http://localhost:4310/api/buyer/chat", {
    method: "POST", headers,
    body: JSON.stringify({ message: { id, role: "user", parts: [{ type: "text", text: input.prompt }] } }),
  });
  const started = Date.now();
  const response = await POST(request());
  const stream = await response.text();
  const messages = await loadMessages(input.conversationId);
  const last = messages.at(-1);
  const evidence: BuyerTurnEvidence = {
    prompt: input.prompt, latencyMs: Date.now() - started, status: response.status, stream,
    reply: last?.role === "assistant" ? conversationText(last) : "", messages,
    reloaded: false, retryDidNotDuplicate: false,
  };
  await input.record(evidence);
  assert.equal(response.status, 200, "Chat handler refused the request");
  const events = stream.split("\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(line => JSON.parse(line.slice(6)) as { type: string; id?: string; delta?: string });
  assert(!events.some(event => event.type === "error"), "The real model stream failed; see private evidence");
  assert(!events.some(event => event.type === "tool-output-error"), "A tool failed during the real turn; review even if the model recovered");
  assert(evidence.reply.trim(), "No completed assistant answer was persisted");
  const textParts = new Map<string, string>();
  for (const event of events) if (event.type === "text-delta") textParts.set(event.id ?? "", (textParts.get(event.id ?? "") ?? "") + (event.delta ?? ""));
  assert.equal([...textParts.values()].join("\n"), evidence.reply,
    "Displayed text differs from stored reply");
  const reload = await GET(new Request("http://localhost:4310/api/buyer/chat", { headers }), undefined);
  assert.equal(reload.status, 200);
  const body = await reload.json() as { data: { messages: UIMessage[]; replyState: string } };
  assert.deepEqual(body.data.messages, messages, "Reload lost or changed conversation content");
  assert.equal(body.data.replyState, "idle", "Completed reply still appears interrupted");
  evidence.reloaded = true;
  const retry = await POST(request());
  await retry.text();
  assert.equal(retry.status, 200);
  assert.deepEqual(await loadMessages(input.conversationId), messages, "Retry duplicated or altered a completed turn");
  evidence.retryDidNotDuplicate = true;
  await input.record(evidence);
  return evidence;
}
