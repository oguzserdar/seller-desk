import { z } from "zod";
import { reconcilePayment } from "@/server/payments/engine";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ attemptId: z.uuid() }).strict();

/** "Check again" for a payment that is still uncertain or pending. Never creates a second charge. */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const { attemptId } = Body.parse(await readJson(request));
  const view = await reconcilePayment(buyer, attemptId, { mayCapture: true });
  return ok(requestId, view, view.headline, view.next);
});
