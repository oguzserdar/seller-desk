/**
 * Writes the next message for a preset customer in a shop test. The model plays
 * only the customer, from a fixed brief and the shop's published offer titles,
 * so it asks about things the shop sells; it never writes the assistant's side.
 * After LangWatch Scenario's user simulator: short, human messages.
 */
import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { PERSONAS, type PersonaId } from "@/lib/simulation-personas";
import type { SimulationSideResult } from "@/lib/simulation";

/** Where this message falls among the persona's messages in the test. */
type Position = { index: number; total: number };

// A one-message test must still try the persona's move; settling belongs only to the last of several messages.
const position = ({ index, total }: Position) =>
  total === 1 ? "This is your only message: make your persona's first move, and do not give up or settle in it."
    : index === total - 1 ? "This is your last message."
      : `This is message ${index + 1} of ${total}.`;

const instructions = (persona: PersonaId, titles: string[], at: Position) => [
  "You are pretending to be a customer chatting with a shop's AI assistant, to test whether it handles you correctly.",
  "Write like a real person in a chat box: one short message, plain words, no lists.",
  "You are the customer, never the assistant. Do not answer your own questions or say what the shop will do.",
  `The shop sells: ${titles.slice(0, 40).join("; ") || "(no published offers)"}. Only ask about these.`,
  `<persona>${PERSONAS[persona].brief}</persona>`,
  position(at),
  "Put only your next message to the assistant in the message field: no notes, reasoning or quotation marks.",
].join("\n");

/** The customer's next message, given the conversation so far. */
export async function nextCustomerMessage(model: LanguageModel, persona: PersonaId, titles: string[], transcript: SimulationSideResult["transcript"], at: Position): Promise<string> {
  // The simulator sees the chat from the customer's side, so the roles are swapped.
  const seen: ModelMessage[] = transcript
    .filter((line) => line.role !== "seller")
    .map((line) => ({ role: line.role === "user" ? "assistant" : "user", content: line.text }));
  // Structured output keeps the model's own reasoning out of what the customer says.
  const { output } = await generateText({
    model,
    instructions: instructions(persona, titles, at),
    messages: seen.length ? seen : [{ role: "user", content: "(The chat is open. Send your first message.)" }],
    output: Output.object({ schema: z.object({ message: z.string() }), name: "customer_message" }),
    maxOutputTokens: 400, maxRetries: 0, timeout: 30_000,
  });
  const message = output.message.trim().slice(0, 2000);
  if (!message) throw new Error("The simulated customer wrote nothing.");
  return message;
}
