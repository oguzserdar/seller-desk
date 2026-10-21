/**
 * Writes the next message for a preset customer in a shop test. The model plays
 * only the customer, from a fixed brief and the shop's published offer titles,
 * so it asks about things the shop sells; it never writes the assistant's side.
 * After LangWatch Scenario's user simulator: short, human messages.
 */
import { generateText, type LanguageModel, type ModelMessage } from "ai";
import { PERSONAS, type PersonaId } from "@/lib/simulation-personas";
import type { SimulationSideResult } from "@/lib/simulation";

const instructions = (persona: PersonaId, titles: string[], last: boolean) => [
  "You are pretending to be a customer chatting with a shop's AI assistant, to test whether it handles you correctly.",
  "Write like a real person in a chat box: one short message, plain words, no lists.",
  "You are the customer, never the assistant. Do not answer your own questions or say what the shop will do.",
  `The shop sells: ${titles.slice(0, 40).join("; ") || "(no published offers)"}. Only ask about these.`,
  `<persona>${PERSONAS[persona].brief}</persona>`,
  last ? "This is your last message." : "",
  "Reply with only your next message to the assistant.",
].filter(Boolean).join("\n");

/** The customer's next message, given the conversation so far. */
export async function nextCustomerMessage(model: LanguageModel, persona: PersonaId, titles: string[], transcript: SimulationSideResult["transcript"], last: boolean): Promise<string> {
  // The simulator sees the chat from the customer's side, so the roles are swapped.
  const seen: ModelMessage[] = transcript
    .filter((line) => line.role !== "seller")
    .map((line) => ({ role: line.role === "user" ? "assistant" : "user", content: line.text }));
  const { text } = await generateText({
    model,
    instructions: instructions(persona, titles, last),
    messages: seen.length ? seen : [{ role: "user", content: "(The chat is open. Send your first message.)" }],
    maxOutputTokens: 300, maxRetries: 0, timeout: 30_000,
  });
  const message = text.trim().slice(0, 2000);
  if (!message) throw new Error("The simulated customer wrote nothing.");
  return message;
}
