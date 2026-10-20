import { z } from "zod";
import { cancelCheckout } from "@/server/payments/engine";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ attemptId: z.uuid() }).strict();

/** Abandons an unpaid checkout after checking PayPal first; held stock returns to sale. */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const { attemptId } = Body.parse(await readJson(request));
  const view = await cancelCheckout(buyer, attemptId);
  return ok(requestId, view, view.headline, view.next);
});
