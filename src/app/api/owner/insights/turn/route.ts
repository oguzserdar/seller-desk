import { generateText, jsonSchema, Output, tool, type ModelMessage, type ToolSet } from "ai";
import { WireTurn, type WireAnswer } from "@/components/insights/studio-wire";
import { ASSISTANT_LIMITS, assistantCallSettings, getAssistantModel } from "@/server/ai/registry";
import { requireOwner } from "@/server/auth/owner";
import { DomainError } from "@/server/domain/errors";
import { requireUsage } from "@/server/domain/usage";
import { failure, readJson } from "@/server/http/respond";

// Studio's agents read and rearrange the dashboard in the browser. They cannot reach orders,
// payments, refunds or customers, so a demo visitor may ask too, under the shop's AI limits.
const RULES =
  "You are the analyst inside Seller Desk's Insights dashboard for a small shop. Answer from the dashboard's data only, " +
  "in plain short sentences with amounts in dollars. You can read the data and change the dashboard's widgets and pages. " +
  "You cannot change orders, prices, payments or refunds; if asked, say that the owner does that from the desk.";

/** One model turn for the Insights analyst. Tools come from Studio and run in the browser. */
export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const { owner, seller } = await requireOwner(request.headers);
    // Studio's own agents send their full instructions and the data schema on every turn.
    const turn = WireTurn.parse(await readJson(request, 400_000));
    const assistant = await getAssistantModel();
    if (!assistant.ok) throw new DomainError("unavailable", "The analyst is off: no AI provider is configured.");
    await requireUsage("insights_ai", owner.userId, 600, 40, "You are asking quickly. Try again in a few minutes.");
    await requireUsage("seller_ai_day", seller.id, 86_400, seller.sellerDailyAiTurns, "The assistant has reached today's limit.");

    // Tool results need the tool's name, which only the call that asked for it carries.
    const names = new Map<string, string>();
    const messages: ModelMessage[] = [];
    for (const message of turn.messages) {
      if (message.role === "user" || message.role === "system") {
        messages.push({ role: "user", content: message.content });
      } else if (message.role === "assistant") {
        const parts: Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string> = [];
        if (message.content) parts.push({ type: "text", text: message.content });
        for (const call of message.toolCalls) {
          names.set(call.id, call.name);
          parts.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: safeJson(call.arguments) });
        }
        if (parts.length) messages.push({ role: "assistant", content: parts });
      } else if (message.role === "tool") {
        messages.push({
          role: "tool",
          content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: names.get(message.toolCallId) ?? "tool", output: { type: "text", value: message.content } }],
        });
      }
    }

    const tools: ToolSet = {};
    for (const schema of turn.tools) {
      tools[schema.name] = tool({ description: schema.description, inputSchema: jsonSchema(schema.parameters as Parameters<typeof jsonSchema>[0]) });
    }
    const result = await generateText({
      model: assistant.model,
      instructions: `${RULES}\n\n${turn.instructions ?? ""}`,
      // Studio's agents ask for structured answers; the provider enforces the schema natively.
      ...(turn.json ? { output: Output.object({ schema: jsonSchema(turn.json.schema as Parameters<typeof jsonSchema>[0]), name: turn.json.name }) } : {}),
      messages,
      ...(turn.tools.length ? { tools, toolChoice: toolChoiceOf(turn.toolChoice) } : {}),
      maxRetries: 0,
      maxOutputTokens: ASSISTANT_LIMITS.maxOutputTokens * 2,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs)]),
      ...assistantCallSettings(),
    });
    const answer: WireAnswer = {
      content: turn.json ? JSON.stringify(result.output) : result.text,
      toolCalls: result.toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, arguments: JSON.stringify(call.input ?? {}) })),
      model: assistant.modelId,
    };
    return Response.json(answer, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  } catch (error) {
    return failure(requestId, error);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toolChoiceOf(choice: WireTurn["toolChoice"]) {
  if (!choice) return "auto" as const;
  return typeof choice === "string" ? choice : { type: "tool" as const, toolName: choice.name };
}
