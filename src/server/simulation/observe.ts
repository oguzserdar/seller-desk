/** Reads the actual UI stream without exporting provider errors, tool payloads or capability links. */
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from "ai";
import { conversationText, sellerReplyOf } from "@/lib/conversation-messages";
import type { SimulationSideResult } from "@/lib/simulation";

/** Consumes the whole response before the isolated database pool may close. */
export async function observeSimulationResponse(response: Response) {
  let message: UIMessage | null = null;
  let failed = !response.ok;
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return { message, failed: true };
  }
  try {
    const stream = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
      .pipeThrough(new TransformStream({ transform(part, controller: TransformStreamDefaultController<UIMessageChunk>) {
        if (part.success) controller.enqueue(part.value);
        else { failed = true; /* Drain later events; never expose parser/provider error bodies. */ }
      } }));
    for await (const next of readUIMessageStream({ stream, onError: () => { failed = true; } })) message = next;
  } catch { failed = true; }
  return { message, failed };
}

/** Redacts links and this trial's bearer token even if a model repeats them in prose. */
export function simulationText(text: string, token: string): string {
  return text.replace(/https?:\/\/[^\s<>]+/gi, "[link omitted]").replaceAll(token, "[private session]").slice(0, 10000);
}

/** Maps observed messages to text and tool states, with no raw tool inputs or outputs. */
export function simulationTranscript(messages: UIMessage[], token: string): Pick<SimulationSideResult, "transcript" | "tools"> {
  const transcript: SimulationSideResult["transcript"] = [];
  const tools: SimulationSideResult["tools"] = [];
  for (const message of messages) {
    const text = simulationText(conversationText(message), token);
    if (text) transcript.push({ role: sellerReplyOf(message) ? "seller" : message.role === "user" ? "user" : "assistant", text });
    for (const part of message.parts) {
      if (part.type.startsWith("tool-") && "state" in part && (part.state === "output-available" || part.state === "output-error")) {
        const name = part.type.slice(5);
        if (/^[a-z][a-z0-9_]{0,79}$/.test(name)) tools.push({ name, state: part.state });
      }
    }
  }
  return { transcript: transcript.slice(-40), tools: tools.slice(-200) };
}
