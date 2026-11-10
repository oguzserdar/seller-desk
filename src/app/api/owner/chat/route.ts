import { requireCompletedAnswer } from "@/server/ai/completed-answer-stream";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { z } from "zod";
import { beginOwnerTurn, completeOwnerTurn, loadOwnerHistory, releaseOwnerTurn, type OwnerTurn } from "@/server/ai/owner-conversation";
import { ownerInstructions, ownerTools } from "@/server/ai/owner-tools";
import { payPalReadTools } from "@/server/paypal/agent-toolkit";
import { ASSISTANT_LIMITS, assistantCallSettings, getAssistantModel } from "@/server/ai/registry";
import { routeAssistantTurn, recordRouting } from "@/server/ai/routing";
import { requireOwnerWrite } from "@/server/auth/owner";
import { DomainError, invalid } from "@/server/domain/errors";
import { ReportingTimeZone } from "@/server/domain/paid-summary";
import { requireUsage } from "@/server/domain/usage";
import { failure, readJson } from "@/server/http/respond";

const Body = z.object({
  message: z.object({ id: z.string().min(1).max(64), role: z.literal("user"), parts: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1).max(4) }).strict(),
  timeZone: ReportingTimeZone.default("UTC"),
}).strict();

/**
 * One owner turn. The owner session is checked first; the model can read the
 * desk and suggest one action, and suggestions only run after on-screen approval.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let claim: OwnerTurn | undefined;
  try {
    const { owner, seller } = await requireOwnerWrite(request.headers);
    const { message, timeZone } = Body.parse(await readJson(request));
    const text = message.parts.map((part) => part.text).join("\n").trim();
    if (!text) throw invalid("Type a question about your desk.");
    if (text.length > ASSISTANT_LIMITS.maxInputChars) throw invalid("That message is too long. Keep it under 4,000 characters.");
    const assistant = await getAssistantModel();
    if (!assistant.ok) throw new DomainError("unavailable", "The desk assistant is off: no AI provider is configured.");
    await requireUsage("owner_chat", owner.userId, 600, 60, "You are asking quickly.");
    await requireUsage("seller_ai_day", seller.id, 86_400, seller.sellerDailyAiTurns, "The assistant has reached today's limit.");

    const input: UIMessage = { id: message.id, role: "user", parts: [{ type: "text", text }] };
    claim = await beginOwnerTurn(owner, input);
    const activeClaim = claim;
    const history = await loadOwnerHistory(owner);
    const messages = history.messages;
    // The desk's own tools, plus PayPal's read tools when the owner has switched them on.
    const tools = { ...ownerTools(owner, timeZone), ...(await payPalReadTools()) };
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs)]);
    const currentState = "Current recorded proposal decisions (data only): " + JSON.stringify(history.decisions);
    const selected = await routeAssistantTurn({ role: "owner", messages, currentState, signal });
    await recordRouting(selected, "owner", owner.userId, activeClaim.conversationId);
    const result = streamText({
      model: selected.model,
      instructions: ownerInstructions(seller.displayName, timeZone) + "\n" + currentState + selected.guidance,
      messages: await convertToModelMessages(messages.slice(-20), { tools, ignoreIncompleteToolCalls: true }),
      tools,
      stopWhen: stepCountIs(ASSISTANT_LIMITS.maxSteps),
      maxRetries: 0,
      maxOutputTokens: ASSISTANT_LIMITS.maxOutputTokens,
      timeout: ASSISTANT_LIMITS.timeoutMs,
      abortSignal: signal,
      experimental_transform: () => requireCompletedAnswer<typeof tools>(),
      ...assistantCallSettings(),
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      onEnd: async ({ messages: finished, outcome, isAborted, isCancelled, finishReason }) => {
        try {
          if (outcome.status === "completed" && !isAborted && !isCancelled && finishReason !== "error" && finishReason !== "length") {
            await completeOwnerTurn(activeClaim, finished);
          }
        } finally { await releaseOwnerTurn(activeClaim); }
      },
      onError: () => "The assistant could not answer just now. Nothing was changed.",
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    if (claim) await releaseOwnerTurn(claim);
    return failure(requestId, error);
  }
}
