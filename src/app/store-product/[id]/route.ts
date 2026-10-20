import { z } from "zod";
import { getServerConfig } from "@/server/env";
import { readWooProduct } from "@/server/commerce/woo-products";
import { getSeller } from "@/server/domain/seller";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { route } from "@/server/http/respond";

/** Public product-page handoff. Never forwards buyer identity, tokens, cart or payment parameters. */
export const GET = route(async (request, _requestId, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const productId = z.coerce.number().int().positive().safe().parse(id);
  const store = getServerConfig().store;
  const unavailable = () => new Response(null, { status: 303, headers: { Location: "/store-product/unavailable", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (!store || !await getSeller() || new URL(request.url).searchParams.get("connection") !== store.connection) return unavailable();
  await requireUsage("store_product_client", clientKey(request.headers), 600, 60, "Too many store checks.");
  try {
    const { destination } = await readWooProduct(store, productId, request.signal);
    return new Response(null, { status: 302, headers: { Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return unavailable(); }
});
