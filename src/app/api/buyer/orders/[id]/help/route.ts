import { buyerOrderFollowup } from "@/server/domain/order-followup";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { optionalBuyer } from "@/server/http/buyer";
import { ok, readJson, route } from "@/server/http/respond";
import { BuyerOrderFollowupInput } from "@/lib/order-followup";
import { invalid } from "@/server/domain/errors";

/** Buyer session or signed receipt access; the route chooses the target, never a client-provided shop. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  await requireUsage("order_help_client", clientKey(request.headers), 600, 30, "Too many messages from this connection.");
  const buyer = await optionalBuyer(request).catch(() => null);
  const { id } = await params;
  const body = BuyerOrderFollowupInput.parse(await readJson(request, 6000));
  // Parse the body strictly; a mismatched target must not silently change the intended order.
  if (body.orderId !== id) throw invalid("That request does not match this order.");
  const view = await buyerOrderFollowup({ buyer, key: request.headers.get("x-order-key") }, body);
  return ok(requestId, view, body.action === "confirm" ? "Your confirmation is saved." : "Your message is saved for the shop.");
});
