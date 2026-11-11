import { generateText, jsonSchema, Output, tool, type ModelMessage, type ToolSet } from "ai";
import { WireTurn, type WireAnswer } from "@/components/insights/studio-wire";
import { ASSISTANT_LIMITS, assistantCallSettings, getAssistantModel } from "@/server/ai/registry";
import { requireOwner } from "@/server/auth/owner";
import { DomainError, invalid } from "@/server/domain/errors";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { failure, readJson } from "@/server/http/respond";

// Studio's agents read and rearrange the dashboard in the browser. They cannot reach orders,
// payments, refunds or customers, so a demo visitor may ask too, but never on the owner's limits:
// visitors get their own small allowance per address and a shared daily total.
const VIEWER_PER_ADDRESS = { windowSeconds: 600, turns: 12 } as const;
const VIEWER_DAILY_TOTAL = 150;
/** Room for Studio's own agent instructions and data schema, not for using this route as a free model. */
const MAX_TURN_CHARS = 160_000;

const RULES =
  "You are the analyst inside Seller Desk's Insights dashboard for a small shop. Answer from the dashboard's data only, " +
  "in plain short sentences with amounts in dollars. Name customers by their Customer label, never by an ID. You can read the data and change the dashboard's widgets and pages. " +
  "You cannot change orders, prices, payments or refunds; if asked, say that the owner does that from the desk.";

/** One model turn for the Insights analyst. Tools come from Studio and run in the browser. */
export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const { owner, seller, viewer } = await requireOwner(request.headers);
    // Studio's own agents send their full instructions and the data schema on every turn.
    const turn = WireTurn.parse(await readJson(request, 400_000));
    const size = (turn.instructions?.length ?? 0) + turn.messages.reduce((total, message) => total + message.content.length, 0);
    if (size > MAX_TURN_CHARS) throw invalid("That conversation is too long. Start a new chat.");
    if (viewer) {
      const address = clientKey(request.headers);
      await requireUsage("insights_demo", address, VIEWER_PER_ADDRESS.windowSeconds, VIEWER_PER_ADDRESS.turns, "The demo analyst is resting.");
      await requireUsage("insights_demo_day", seller.id, 86_400, VIEWER_DAILY_TOTAL, "The demo analyst has answered enough questions for today.");
    } else {
      await requireUsage("insights_ai", owner.userId, 600, 40, "You are asking quickly.");
      await requireUsage("seller_ai_day", seller.id, 86_400, seller.sellerDailyAiTurns, "The assistant has reached today's limit.");
    }
    const assistant = await getAssistantModel();
    if (!assistant.ok) throw new DomainError("unavailable", "The analyst is off: no AI provider is configured.");


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
          parts.push({ type: "tool-call", toolCallId: call.id, toolName: call.name, input: parseArguments(call.arguments) });
        }
        if (parts.length) messages.push({ role: "assistant", content: parts });
      } else if (message.role === "tool") {
        messages.push({
          role: "tool",
          content: [{ type: "tool-result", toolCallId: message.toolCallId, toolName: answered(names, message.toolCallId), output: { type: "text", value: message.content } }],
        });
      }
    }

    const tools: ToolSet = {};
    for (const schema of turn.tools) {
      tools[schema.name] = tool({ description: schema.description, inputSchema: jsonSchema(schema.parameters as Parameters<typeof jsonSchema>[0]) });
    }
    const result = await generateText({
      model: assistant.model,
      // Studio's agent instructions first; the shop's rules last, so they win any conflict.
      instructions: `${turn.instructions ?? ""}\n\n${RULES}`,
      // Studio's agents ask for structured answers; the provider enforces the schema natively.
      ...(turn.json ? { output: Output.object({ schema: jsonSchema(turn.json.schema as Parameters<typeof jsonSchema>[0]), name: turn.json.name }) } : {}),
      messages,
      ...(turn.tools.length ? { tools, toolChoice: toolChoiceOf(turn.toolChoice, tools) } : {}),
      maxRetries: 0,
      maxOutputTokens: ASSISTANT_LIMITS.maxOutputTokens,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs)]),
      ...assistantCallSettings(),
    });
    const answer: WireAnswer = {
      // A structured answer exists only when the model did not stop to call a tool.
      content: turn.json && result.toolCalls.length === 0 ? JSON.stringify(result.output) : result.text,
      toolCalls: result.toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, arguments: JSON.stringify(call.input ?? {}) })),
      model: assistant.modelId,
      usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
    };
    return Response.json(answer, { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  } catch (error) {
    return failure(requestId, error);
  }
}

/** Tool arguments as Studio sent them; a turn with unreadable arguments is refused, not patched. */
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid("That analyst turn had unreadable tool arguments. Start a new chat.");
  }
}

/** A tool result must answer a call made earlier in the same conversation. */
function answered(names: Map<string, string>, callId: string): string {
  const name = names.get(callId);
  if (!name) throw invalid("That analyst turn answered a tool call that was never made. Start a new chat.");
  return name;
}

function toolChoiceOf(choice: WireTurn["toolChoice"], tools: ToolSet) {
  if (!choice) return "auto" as const;
  if (typeof choice === "string") return choice;
  return choice.name in tools ? { type: "tool" as const, toolName: choice.name } : ("auto" as const);
}
