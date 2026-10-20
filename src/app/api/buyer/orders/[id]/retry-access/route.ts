import { issueGrants } from "@/server/domain/digital";
import { notFound } from "@/server/domain/errors";
import { checkOrderAccessKey, getBuyerOrder } from "@/server/domain/orders";
import { optionalBuyer } from "@/server/http/buyer";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { ok, route } from "@/server/http/respond";

/** The paying buyer retries download access. Grants are idempotent and nothing is charged. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  await requireUsage("buyer_access_retry_client", clientKey(request.headers), 600, 30, "Too many retries from this connection.");
  const buyer = await optionalBuyer(request).catch(() => null);
  const key = request.headers.get("x-order-key");
  const { id } = await params;
  await getBuyerOrder({ buyer, key }, id);
  const actorId = buyer?.buyerSessionId ?? (checkOrderAccessKey(id, key) ? "order-link" : null);
  if (!actorId) throw notFound("order");
  const outcome = await issueGrants(id, { actor: "buyer", actorId });
  const view = await getBuyerOrder({ buyer, key }, id);
  const message =
    outcome.outcome === "granted" ? "Your download is ready." : outcome.outcome === "failed" ? "Access did not open yet. Your payment is safe; try again shortly." : outcome.reason === "no_digital_lines" ? "This order has no downloads." : outcome.reason;
  return ok(requestId, view, message);
});
