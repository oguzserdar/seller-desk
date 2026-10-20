import { z } from "zod";
import { reconcilePayment } from "@/server/payments/engine";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ attemptId: z.uuid() }).strict();

/**
 * Called after the buyer returns from PayPal. The return URL's parameters are
 * not trusted: the server reads its own stored PayPal order, captures it only
 * if PayPal says it is approved, and reads PayPal again before recording payment.
 */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const { attemptId } = Body.parse(await readJson(request));
  const view = await reconcilePayment(buyer, attemptId, { mayCapture: true });
  return ok(requestId, view, view.headline, view.next);
});
