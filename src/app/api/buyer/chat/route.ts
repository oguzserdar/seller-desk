import { ensureConversation } from "@/server/ai/conversation";
import { getAssistantModel } from "@/server/ai/registry";
import { respondToBuyer } from "@/server/ai/buyer-response";
import { readBuyerConversation } from "@/server/domain/conversation-messages";
import { latestQuestion } from "@/server/domain/seller-questions";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

/** The buyer's stored conversation, for reloads and the full-page handoff. */
export const GET = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const snapshot = await readBuyerConversation(buyer, await ensureConversation(buyer));
  const assistant = getAssistantModel();
  const question = await latestQuestion(buyer);
  return ok(requestId, {
    ...snapshot,
    assistant: assistant.ok,
    handoff: question ? { question: question.question, answer: question.answer, state: question.state, deliveredBySeller: question.state === "closed" && Boolean(question.answer) && !question.resumeError, retrying: question.state === "answered" && question.resumeAttempts > 0 && question.resumeError !== null } : null,
  });
});

/** Runs the shared authenticated buyer handler used by chat and isolated simulations. */
export const POST = respondToBuyer;
