import { endBuyerSession } from "@/server/domain/buyer-session";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

/** "Forget this chat": revokes the session everywhere it was used. */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  await endBuyerSession(buyer);
  return ok(requestId, { ended: true }, "This chat has ended on every device.", ["start_session"]);
});
