import { ensureConversation } from "@/server/ai/conversation";
import { stopTurn } from "@/server/ai/turn-control";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

/** Stops this buyer's running reply so the chat is free again at once. */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  await stopTurn(buyer, await ensureConversation(buyer));
  return ok(requestId, { stopped: true });
});
