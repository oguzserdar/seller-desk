/**
 * Free evals: the real buyer assistant, its tools and the server's guards run
 * against an isolated SQLite shop while a scripted stand-in plays the model. No
 * model is called. Each case is graded on what the shop stored, not on wording.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { getSeller } from "@/server/domain/seller";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

type Step = { tool: string; input: Record<string, unknown> } | { text: string };

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** A stand-in model that answers each call with the next scripted step. */
function standIn(script: Step[]) {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const step = script[Math.min(call++, script.length - 1)]!;
      return "tool" in step
        ? { content: [{ type: "tool-call", toolCallId: `c${call}`, toolName: step.tool, input: JSON.stringify(step.input) }], finishReason: { unified: "tool-calls", raw: "tool_use" }, usage, warnings: [] }
        : { content: [{ type: "text", text: step.text }], finishReason: { unified: "stop", raw: "end_turn" }, usage, warnings: [] };
    },
  });
}

let f: StorageFixture;
beforeEach(async () => { f = await newStorageFixture("d1"); });
afterEach(async () => { await f?.close(); });

/** Runs one buyer turn with the stand-in inside the fixture's isolated SQLite shop. */
async function turn(prompt: string, script: Step[]) {
  return withD1Database(createD1Db(f.binding!), async () => {
    const id = await ensureConversation(f.buyer);
    const assistantTurn = (await claimTurn(f.buyer, id))!;
    const agent = buyerAgent(standIn(script), { ...f.buyer, assistantTurn }, (await getSeller())!, "No purchase yet.", "", { requireFirstTool: false });
    return agent.generate({ prompt });
  });
}

const quoteRequest = (offerId: string, quantity: number) => ({ tool: "propose_quote", input: { mode: "replace", lines: [{ offerId, quantity }], budgetMinor: null, deliveryRequested: false, buyerNote: null } });
const toolOutputs = (result: Awaited<ReturnType<typeof turn>>) => result.steps.flatMap((step) => step.toolResults.map((r) => r.output as { error?: string }));
const storedQuantities = async () => (await f.query("SELECT lines FROM quote")).flatMap((row) => (JSON.parse(String(row.lines)) as { quantity: number }[]).map((line) => line.quantity));

describe("server guards hold whatever the model asks for", () => {
  it("refuses a quantity above the offer's order limit and stores no quote", async () => {
    const result = await turn("I want 99 of these", [quoteRequest(f.goodsId, 99), { text: "Done." }]);
    expect(toolOutputs(result)[0]?.error).toMatch(/up to/);
    expect(await storedQuantities()).toEqual([]);
  });

  it("keeps a quote for more goods than are in stock unpayable, and says why", async () => {
    const [stock] = await f.query("SELECT total FROM inventory WHERE offer_id=?", [f.goodsId]);
    const wanted = Number(stock!.total) + 3;
    await turn(`I want ${wanted} of these`, [quoteRequest(f.goodsId, wanted), { text: "Done." }]);
    const quotes = await f.query("SELECT status, unresolved FROM quote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.status).not.toBe("review_ready");
    expect(JSON.parse(String(quotes[0]!.unresolved))).toEqual(expect.arrayContaining([expect.objectContaining({ code: "quantity_unavailable" })]));
  });
});
