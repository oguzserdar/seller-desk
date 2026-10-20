import { z } from "zod";
import { startCheckout } from "@/server/payments/engine";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ quoteId: z.uuid(), revision: z.number().int().min(1) }).strict();

/**
 * Accepts the reviewed quote revision and returns the PayPal approval link.
 * Repeating the call joins the same payment attempt; it never starts a second one.
 */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const input = Body.parse(await readJson(request));
  const view = await startCheckout(buyer, input);
  return ok(requestId, view, view.headline, view.next);
});
