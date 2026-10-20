import { getPaymentView } from "@/server/payments/engine";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

/** Read-only payment status. Never calls PayPal and never changes state. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, requestId, { params }) => {
  const buyer = await buyerFrom(request);
  const { id } = await params;
  const view = await getPaymentView(buyer, id);
  return ok(requestId, view, view.headline, view.next);
});
