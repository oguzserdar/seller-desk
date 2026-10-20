import { z } from "zod";
import { cancelQuote } from "@/server/domain/quotes";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ revision: z.number().int().min(1) }).strict();

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  const buyer = await buyerFrom(request);
  const { id } = await params;
  const { revision } = Body.parse(await readJson(request));
  const view = await cancelQuote(buyer, { quoteId: id, revision });
  return ok(requestId, view, "Quote cancelled. Nothing was charged.", view.next);
});
