import { requireCompletedAnswer } from "@/server/ai/completed-answer-stream";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { buyerAgent } from "@/server/ai/buyer-agent";
import { routeAssistantTurn, recordRouting } from "@/server/ai/routing";
import { buyerState } from "@/server/ai/buyer-tools";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import { ASSISTANT_LIMITS, getAssistantModel } from "@/server/ai/registry";
import { watchTurn, guardTurnStream } from "@/server/ai/turn-runtime";
import { sellerReplyToModel } from "@/lib/conversation-messages";
import { receiveBuyerMessage } from "@/server/domain/conversation-messages";
import { completeTurn, releaseTurn, type TurnClaim } from "@/server/ai/turn-control";
import { DomainError, invalid } from "@/server/domain/errors";
import { getSeller } from "@/server/domain/seller";
import { requireUsage } from "@/server/domain/usage";
import { buyerFrom } from "@/server/http/buyer";
import { failure, readJson } from "@/server/http/respond";

const Body = z
  .object({
    message: z.object({
      id: z.string().min(1).max(64),
      role: z.literal("user"),
      parts: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1).max(4),
    }),
  })
  .strip();

/**
 * One buyer turn. Limits are checked before any model call; the model sees the
 * server's stored history plus this message, and can act only through the
 * buyer tools. The reply streams as UI message parts.
 */
export async function respondToBuyer(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let claim: TurnClaim | undefined;
  let watcher: ReturnType<typeof watchTurn> | undefined;
  try {
    const buyer = await buyerFrom(request);
    const { message } = Body.parse(await readJson(request));
    const text = message.parts.map((part) => part.text).join("\n").trim();
    if (!text) throw invalid("Type what you are looking for.");
    if (text.length > ASSISTANT_LIMITS.maxInputChars) throw invalid("That message is too long. Keep it under 4,000 characters.");

    const shop = await getSeller();
    if (!shop || shop.id !== buyer.sellerId) throw new DomainError("unavailable", "This shop is not open right now.");
    const assistant = getAssistantModel();
    const conversationId = await ensureConversation(buyer);
    await requireUsage("buyer_chat", buyer.buyerSessionId, 600, shop.buyerTurnsPer10Min, "You are sending messages quickly.");
    const received = await receiveBuyerMessage(buyer, conversationId, { id: message.id, text }, assistant.ok);
    if (!received.claim) {
      // Transport receipt only. No assistant message or simulated model reply.
      return createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
        writer.write({ type: "data-conversation-control", data: received.control, transient: true });
      } }), headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
    }
    claim = received.claim;
    const activeClaim = claim;
    await requireUsage("seller_ai_day", shop.id, 86_400, shop.sellerDailyAiTurns, "The shop assistant has answered its daily limit.");
    const messages = await loadMessages(conversationId);
    const assistantBuyer = { ...buyer, assistantTurn: activeClaim };
    watcher = watchTurn(assistantBuyer, AbortSignal.any([request.signal, AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs)]));
    const signal = watcher.signal;
    const activeWatcher = watcher;
    const currentState = await buyerState(buyer);
    const selected = await routeAssistantTurn({ role: "buyer", messages, currentState, signal });
    await recordRouting(selected, "buyer", buyer.buyerSessionId, conversationId);
    const agent = buyerAgent(selected.model, assistantBuyer, shop, currentState, selected.guidance);

    const result = await agent.stream({
      messages: await convertToModelMessages(messages, { tools: agent.tools, ignoreIncompleteToolCalls: true, convertDataPart: sellerReplyToModel }),
      timeout: ASSISTANT_LIMITS.timeoutMs,
      abortSignal: signal,
      experimental_transform: [() => guardTurnStream(assistantBuyer, activeWatcher.abort), () => requireCompletedAnswer()],
    });
    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      onEnd: async ({ messages: finished, outcome, isAborted, isCancelled, finishReason }) => {
        try {
          if (outcome.status === "completed" && !signal.aborted && !isAborted && !isCancelled && finishReason !== "error" && finishReason !== "length") {
            await completeTurn(activeClaim, finished);
          }
        } finally { activeWatcher.dispose(); await releaseTurn(activeClaim); }
      },
      onError: () => "The assistant could not finish. Check your current quote before trying again.",
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    watcher?.dispose();
    if (claim) await releaseTurn(claim);
    return failure(requestId, error);
  }
}
