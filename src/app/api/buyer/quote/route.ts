import { proposeQuote } from "@/server/domain/quotes";
import { getCurrentBuyerQuote } from "@/server/domain/current-quote";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

/** Returns the authenticated buyer's current quote for page and widget reloads. */
export const GET = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  return ok(requestId, await getCurrentBuyerQuote(buyer));
});

/**
 * Creates a quote or the next revision of the buyer's quote thread. The body
 * names offers and quantities only; any price or total in it is refused.
 */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const view = await proposeQuote(buyer, (await readJson(request)) as never);
  return ok(requestId, view, view.status === "review_ready" ? "Quote ready to review." : "Quote saved; something needs attention first.", view.next, 201);
});
