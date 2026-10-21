/**
 * Shared runner for buyer-assistant evals: an isolated SQLite shop (the D1
 * storage fixture) and one real buyer turn with whichever model is supplied,
 * a scripted stand-in or a live provider. Grading reads only what the shop stored.
 */
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { getSeller } from "@/server/domain/seller";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import type { StorageFixture } from "./storage-fixture";

/** Runs one buyer turn inside the fixture's isolated SQLite shop, from a single message or the whole history. */
export function runBuyerTurn(f: StorageFixture, model: LanguageModel, input: string | ModelMessage[], options?: { requireFirstTool?: boolean }) {
  return withD1Database(createD1Db(f.binding!), async () => {
    const id = await ensureConversation(f.buyer);
    const assistantTurn = (await claimTurn(f.buyer, id))!;
    const agent = buyerAgent(model, { ...f.buyer, assistantTurn }, (await getSeller())!, "No purchase yet.", "", options);
    return typeof input === "string" ? agent.generate({ prompt: input }) : agent.generate({ messages: input });
  });
}

/** A simulated customer: who they are and what they are trying to get. */
export type Persona = { name: string; persona: string; goal: string };

// After LangWatch Scenario's user simulator: the model plays a human customer with
// short inputs and never takes over the assistant's side of the conversation.
const SIMULATOR = (p: Persona) => [
  "You are pretending to be a customer chatting with a shop's AI assistant, to test whether it handles you correctly.",
  "Write like a real person in a chat box: short messages, plain words, no lists.",
  "You are the customer, never the assistant. Do not answer your own questions or describe what the shop will do.",
  `<persona>${p.persona}</persona>`,
  `<goal>${p.goal}</goal>`,
  "Reply with only your next message to the assistant.",
].join("\n");

/** Plays a persona against the real assistant for a few turns, carrying the history like the live chat. */
export async function runPersona(f: StorageFixture, assistant: LanguageModel, simulator: LanguageModel, p: Persona, turns = 3) {
  const history: ModelMessage[] = [];
  const transcript: { role: "customer" | "assistant"; text: string }[] = [];
  for (let turn = 0; turn < turns; turn++) {
    // The simulator sees the conversation from the customer's side, so roles are swapped.
    const seen: ModelMessage[] = transcript.map((line) => ({ role: line.role === "customer" ? "assistant" : "user", content: line.text }));
    const { text } = await generateText({ model: simulator, instructions: SIMULATOR(p), messages: seen.length ? seen : [{ role: "user", content: "(The chat is open. Send your first message.)" }], maxOutputTokens: 200 });
    transcript.push({ role: "customer", text: text.trim() });
    history.push({ role: "user", content: text.trim() });
    const result = await runBuyerTurn(f, assistant, history);
    history.push(...result.response.messages);
    transcript.push({ role: "assistant", text: result.text });
  }
  return transcript;
}

/** Every stored quote with its parsed lines, the state graders read. */
export async function storedQuotes(f: StorageFixture) {
  return (await f.query("SELECT status, total_minor, lines, unresolved FROM quote")).map((row) => ({
    status: String(row.status),
    totalMinor: row.total_minor === null ? null : Number(row.total_minor),
    lines: JSON.parse(String(row.lines)) as { offerId: string; quantity: number }[],
  }));
}
