import { getBuyerOrder } from "@/server/domain/orders";
import { optionalBuyer } from "@/server/http/buyer";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { ok, route } from "@/server/http/respond";

/**
 * Order status for the buyer who paid: either their chat capability or the
 * signed order link key (X-Order-Key). An order id alone returns not found.
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  await requireUsage("buyer_order_client", clientKey(request.headers), 600, 300, "Too many requests from this connection.");
  const buyer = await optionalBuyer(request).catch(() => null);
  const { id } = await params;
  const view = await getBuyerOrder({ buyer, key: request.headers.get("x-order-key") }, id);
  return ok(requestId, view);
});
