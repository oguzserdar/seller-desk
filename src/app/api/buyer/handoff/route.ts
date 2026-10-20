import { z } from "zod";
import { createHandoff } from "@/server/domain/buyer-session";
import { buyerFrom } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";

const Body = z.object({ quoteId: z.uuid().nullable() }).strict();

/** A two-minute, one-time code that carries this buyer from the widget to the full checkout page. */
export const POST = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const { quoteId } = Body.parse(await readJson(request));
  const { code } = await createHandoff(buyer, quoteId);
  return ok(requestId, { code }, "Opening checkout.");
});
