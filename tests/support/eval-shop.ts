/**
 * Shared runner for buyer-assistant evals: an isolated SQLite shop (the D1
 * storage fixture) and one real buyer turn with whichever model is supplied,
 * a scripted stand-in or a live provider. Grading reads only what the shop stored.
 */
import type { LanguageModel } from "ai";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { getSeller } from "@/server/domain/seller";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import type { StorageFixture } from "./storage-fixture";

/** Runs one buyer turn inside the fixture's isolated SQLite shop. */
export function runBuyerTurn(f: StorageFixture, model: LanguageModel, prompt: string, options?: { requireFirstTool?: boolean }) {
  return withD1Database(createD1Db(f.binding!), async () => {
    const id = await ensureConversation(f.buyer);
    const assistantTurn = (await claimTurn(f.buyer, id))!;
    const agent = buyerAgent(model, { ...f.buyer, assistantTurn }, (await getSeller())!, "No purchase yet.", "", options);
    return agent.generate({ prompt });
  });
}

/** Every stored quote with its parsed lines, the state graders read. */
export async function storedQuotes(f: StorageFixture) {
  return (await f.query("SELECT status, total_minor, lines, unresolved FROM quote")).map((row) => ({
    status: String(row.status),
    totalMinor: row.total_minor === null ? null : Number(row.total_minor),
    lines: JSON.parse(String(row.lines)) as { offerId: string; quantity: number }[],
  }));
}
