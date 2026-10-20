import { getBuyerQuote } from "@/server/domain/quotes";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

export const GET = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  const buyer = await buyerFrom(request);
  const { id } = await params;
  const view = await getBuyerQuote(buyer, id);
  return ok(requestId, view, "OK", view.next);
});
