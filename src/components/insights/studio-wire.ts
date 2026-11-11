/**
 * The wire format between the Insights analyst in the browser and its server turn route.
 * Studio runs the agent loop and its tools in the browser; the server answers one model turn.
 */
import { z } from "zod";

export const WireToolCall = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  arguments: z.string().max(60_000),
});
export type WireToolCall = z.infer<typeof WireToolCall>;

export const WireMessage = z.discriminatedUnion("role", [
  z.object({ role: z.enum(["user", "system"]), content: z.string().max(40_000) }),
  z.object({ role: z.literal("assistant"), content: z.string().max(40_000), toolCalls: z.array(WireToolCall).max(16).default([]) }),
  z.object({ role: z.literal("tool"), toolCallId: z.string().min(1).max(128), content: z.string().max(120_000) }),
]);
export type WireMessage = z.infer<typeof WireMessage>;

export const WireTurn = z
  .object({
    instructions: z.string().max(200_000).optional(),
    messages: z.array(WireMessage).min(1).max(80),
    tools: z
      .array(z.object({ name: z.string().min(1).max(128), description: z.string().max(20_000).default(""), parameters: z.record(z.string(), z.unknown()) }))
      .max(64)
      .default([]),
    toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string().max(128) })]).optional(),
    json: z.object({ name: z.string().max(128), schema: z.record(z.string(), z.unknown()) }).nullable().default(null),
  })
  .strict();
export type WireTurn = z.infer<typeof WireTurn>;

/** One answered turn: text, tool calls for Studio to run, or both. */
export type WireAnswer = { content: string; toolCalls: WireToolCall[]; model: string; usage?: { inputTokens: number; outputTokens: number } };
