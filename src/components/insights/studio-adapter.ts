/**
 * AG Studio's LLM adapter for Seller Desk. Studio owns the agent loop and runs its tools in the
 * browser (changing the dashboard, reading its data); each model turn is answered by
 * /api/owner/insights/turn through the shop's own budgeted AI provider.
 */
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";
import type { WireAnswer, WireMessage, WireTurn } from "./studio-wire";

/** Studio's conversation as our wire turn. Tool calls join the assistant message they came with. */
export function toWireTurn(request: AgLlmRequest): WireTurn {
  const messages: WireMessage[] = [];
  for (const item of request.input) {
    if (item.type === "message" && item.kind === "input") {
      const text = item.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      messages.push({ role: item.role === "system" ? "system" : "user", content: text });
    } else if (item.type === "message") {
      const text = item.content.map((part) => (part.type === "text" ? part.text : part.refusal)).join("");
      messages.push({ role: "assistant", content: text, toolCalls: [] });
    } else if (item.type === "function_call") {
      const call = { id: item.callId, name: item.name, arguments: item.arguments || "{}" };
      const last = messages.at(-1);
      if (last?.role === "assistant") last.toolCalls.push(call);
      else messages.push({ role: "assistant", content: "", toolCalls: [call] });
    } else if (item.type === "function_call_output") {
      messages.push({ role: "tool", toolCallId: item.callId, content: item.output });
    }
  }
  const tools = (request.tools ?? [])
    .filter((schema) => (schema.kind ?? "client") !== "provided")
    .map((schema) => ({ name: schema.name, description: schema.description ?? "", parameters: schema.parameters as Record<string, unknown> }));
  const json = request.responseFormat.type === "json" ? { name: request.responseFormat.name, schema: request.responseFormat.schema as Record<string, unknown> } : null;
  return { instructions: request.instructions, messages, tools, toolChoice: tools.length ? request.toolChoice : undefined, json };
}

function outputOf(id: string, answer: WireAnswer): AgAiOutputItem[] {
  const output: AgAiOutputItem[] = [];
  if (answer.content) {
    output.push({ id: `${id}-text`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: answer.content, annotations: [] }] });
  }
  for (const call of answer.toolCalls) {
    output.push({ id: `${id}-${call.id}`, kind: "output", type: "function_call", callId: call.id, name: call.name, arguments: call.arguments, status: "completed" });
  }
  return output;
}

function* eventsOf(id: string, answer: WireAnswer): Generator<AgAiEvent> {
  if (answer.content) {
    yield { type: "TEXT_MESSAGE_START", messageId: `${id}-text`, role: "assistant" };
    yield { type: "TEXT_MESSAGE_CONTENT", messageId: `${id}-text`, delta: answer.content };
    yield { type: "TEXT_MESSAGE_END", messageId: `${id}-text` };
  }
  for (const call of answer.toolCalls) {
    yield { type: "TOOL_CALL_START", toolCallId: call.id, toolCallName: call.name };
    yield { type: "TOOL_CALL_ARGS", toolCallId: call.id, delta: call.arguments };
    yield { type: "TOOL_CALL_END", toolCallId: call.id };
  }
}

/** The adapter Studio's harness calls once per model turn. */
export function sellerDeskAdapter(endpoint = "/api/owner/insights/turn", polish?: (text: string) => string): AgLlmAdapter {
  let count = 0;
  return {
    executeTurn(request, options) {
      const id = `turn-${Date.now().toString(36)}-${(count++).toString(36)}`;
      const createdAt = Date.now();
      const answer = (async (): Promise<WireAnswer> => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toWireTurn(request)),
          signal: options?.signal,
        });
        const body = (await response.json().catch(() => ({}))) as Partial<WireAnswer> & { message?: string };
        if (!response.ok) throw new Error(body.message ?? "The analyst could not answer just now.");
        const toolCalls = body.toolCalls ?? [];
        // A sub-agent's report goes back through complete_task; give it the owner's names, not raw references.
        const reported = polish ? toolCalls.map((call) => (call.name === "complete_task" ? { ...call, arguments: polishJson(call.arguments, polish) } : call)) : toolCalls;
        return { content: body.content ?? "", toolCalls: reported, model: body.model ?? "", usage: body.usage };
      })();
      // A failed turn is reported on `complete`; the stream just ends, so Studio never waits on it.
      const complete: Promise<AgLlmResponse> = answer.then(
        (result) => ({ id, createdAt, status: "completed", output: outputOf(id, result), model: result.model, ...(result.usage ? { usage: result.usage } : {}) }),
        (error: unknown) => ({
          id,
          createdAt,
          status: options?.signal?.aborted ? "cancelled" : "failed",
          error: { code: "turn_failed", message: error instanceof Error ? error.message : "The analyst could not answer just now." },
          output: [],
        }),
      );
      const stream = {
        async *[Symbol.asyncIterator]() {
          const result = await answer.catch(() => null);
          if (result) yield* eventsOf(id, result);
        },
      };
      return { stream, complete };
    },
  };
}

/** Applies `polish` to every string inside a JSON argument object; unreadable JSON is left as sent. */
function polishJson(text: string, polish: (value: string) => string): string {
  try {
    const walk = (value: unknown): unknown =>
      typeof value === "string" ? polish(value) : Array.isArray(value) ? value.map(walk) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)])) : value;
    return JSON.stringify(walk(JSON.parse(text)));
  } catch {
    return text;
  }
}
