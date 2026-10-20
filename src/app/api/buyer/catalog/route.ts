import { notFound } from "@/server/domain/errors";
import { listPublishedOffers } from "@/server/domain/offers";
import { getSeller } from "@/server/domain/seller";
import { buyerFrom } from "@/server/http/buyer";
import { ok, route } from "@/server/http/respond";

/** The seller's published offers with live availability, plus the terms a buyer needs before paying. */
export const GET = route(async (request, requestId) => {
  const buyer = await buyerFrom(request);
  const shop = await getSeller();
  if (!shop) throw notFound("shop");
  const offers = await listPublishedOffers(buyer.sellerId);
  return ok(requestId, {
    seller: {
      name: shop.displayName,
      currency: shop.currency,
      pickupPolicy: shop.pickupPolicy,
      serviceRequestPolicy: shop.serviceRequestPolicy,
      digitalAccessPolicy: shop.digitalAccessPolicy,
      taxPolicy: shop.taxPolicy,
    },
    offers,
  });
});
