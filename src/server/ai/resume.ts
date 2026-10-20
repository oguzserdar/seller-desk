import { requireCompletedAnswer } from "@/server/ai/completed-answer-stream";
/**
 * Resumes a customer's conversation after the seller answers its question.
 *
 * The answer enters the stored conversation as the result of the agent's
 * check_seller_answer tool, then the same buyer agent takes one more real turn
 * and the reply is saved. Nothing streams to a browser here: the buyer's page
 * picks the new messages up on its next check. A lease on the question makes
 * sure one runner does this once; a failed run is retried by the job runner.
 */
import { sellerReplyToModel } from "@/lib/conversation-messages";
import { AssistantTurnEnded } from "@/server/domain/assistant-turn";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { getSeller } from "@/server/domain/seller";
import {
  claimResume,
  deferResume,
  releaseResume,
} from "@/server/domain/seller-questions";
import { consumeUsage } from "@/server/domain/usage";
import { convertToModelMessages, type UIMessage } from "ai";
import { buyerAgent } from "./buyer-agent";
import { buyerState, describeQuestion } from "./buyer-tools";
import { loadMessages } from "./conversation";
import { ASSISTANT_LIMITS, getAssistantModel } from "./registry";
import { recordRouting, routeAssistantTurn } from "./routing";
import {
  claimTurn,
  completeTurn,
  releaseTurn,
  type TurnClaim,
} from "./turn-control";
import { guardTurnStream, watchTurn } from "./turn-runtime";

/** Whether a real continuation was durably saved, unavailable to claim, or failed. */
export type ResumeOutcome = "resumed" | "skipped" | "failed";

/** Runs one fenced continuation and commits its messages only on successful completion. */
export async function resumeAfterAnswer(
  questionId: string,
  signal?: AbortSignal,
): Promise<ResumeOutcome> {
  if (signal?.aborted) return "skipped";
  const question = await claimResume(questionId);
  if (!question) return "skipped";
  let turn: TurnClaim | undefined;
  let modelStarted = false;
  let watcher: ReturnType<typeof watchTurn> | undefined;
  try {
    signal?.throwIfAborted();
    const assistant = getAssistantModel();
    if (!assistant.ok) throw new Error(assistant.problem);
    const shop = await getSeller();
    if (!shop || shop.id !== question.sellerId)
      throw new Error("The shop for this question is not open.");

    const buyer: BuyerPrincipal = {
      kind: "buyer",
      buyerSessionId: question.buyerSessionId,
      sellerId: question.sellerId,
    };
    turn = await claimTurn(buyer, question.conversationId);
    if (!turn) {
      await deferResume(question, new Date(Date.now() + 30_000));
      return "skipped";
    }
    const usage = await consumeUsage(
      "seller_ai_day",
      shop.id,
      86_400,
      shop.sellerDailyAiTurns,
    );
    if (!usage.allowed) {
      await deferResume(question, usage.resetsAt);
      return "skipped";
    }
    const answerTurn = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool-check_seller_answer",
          toolCallId: `seller-answer-${question.id}`,
          state: "output-available",
          input: {},
          output: {
            ...describeQuestion(question),
            answeredAt: question.answeredAt?.toISOString() ?? null,
          },
        },
      ],
    } as UIMessage;
    const messages = [
      ...(await loadMessages(question.conversationId)),
      answerTurn,
    ];

    const deadline = AbortSignal.timeout(ASSISTANT_LIMITS.timeoutMs);
    const assistantBuyer = { ...buyer, assistantTurn: turn };
    watcher = watchTurn(
      assistantBuyer,
      signal ? AbortSignal.any([signal, deadline]) : deadline,
    );
    const activeWatcher = watcher;
    const turnSignal = watcher.signal;
    const currentState = await buyerState(buyer);
    const selected = await routeAssistantTurn({
      role: "buyer",
      messages,
      currentState,
      signal: turnSignal,
      forceMain: true,
    });
    await recordRouting(
      selected,
      "buyer",
      buyer.buyerSessionId,
      question.conversationId,
    );
    const agent = buyerAgent(
      selected.model,
      assistantBuyer,
      shop,
      currentState,
      selected.guidance,
      { requireFirstTool: false },
    );
    signal?.throwIfAborted();
    modelStarted = true;
    const result = await agent.stream({
      messages: await convertToModelMessages(messages, {
        tools: agent.tools,
        ignoreIncompleteToolCalls: true,
        convertDataPart: sellerReplyToModel,
      }),
      timeout: ASSISTANT_LIMITS.timeoutMs,
      abortSignal: turnSignal,
      experimental_transform: [
        () => guardTurnStream(assistantBuyer, activeWatcher.abort),
        () => requireCompletedAnswer(),
      ],
    });
    let finished: UIMessage[] | null = null;
    const stream = result.toUIMessageStream({
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      onEnd: ({
        messages: done,
        outcome,
        isAborted,
        isCancelled,
        finishReason,
      }) => {
        if (
          outcome.status === "completed" &&
          !isAborted &&
          !isCancelled &&
          finishReason !== "error" &&
          finishReason !== "length"
        )
          finished = done;
      },
      onError: () =>
        "The assistant could not continue. The seller's answer is saved for a retry.",
    });
    const reader = stream.getReader();
    while (!(await reader.read()).done) {
      // The stream is consumed only to completion; the result is the saved messages.
    }
    turnSignal.throwIfAborted();
    if (!finished) throw new Error("The resumed turn did not finish.");
    await completeTurn(turn, finished, question);
    return "resumed";
  } catch (error) {
    if (
      (signal?.aborted && !modelStarted) ||
      error instanceof AssistantTurnEnded ||
      watcher?.signal.reason instanceof AssistantTurnEnded
    ) {
      await deferResume(question, new Date(Date.now() + 30_000));
      return "skipped";
    }
    await releaseResume(
      question,
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  } finally {
    watcher?.dispose();
    if (turn) await releaseTurn(turn);
  }
}
