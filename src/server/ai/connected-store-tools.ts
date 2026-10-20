import { tool } from "ai";
import { z } from "zod";
import type { StoreResult } from "@/lib/connected-store";
import { getServerConfig } from "@/server/env";
import { getSeller } from "@/server/domain/seller";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { readWooProduct, searchWooProducts, StoreSearchInput } from "@/server/commerce/woo-products";

async function storeFor(buyer: BuyerPrincipal) {
  const seller = await getSeller();
  if (!seller || seller.id !== buyer.sellerId) throw notFound("shop");
  return getServerConfig().store;
}

function failed(status: "disconnected" | "unavailable"): StoreResult {
  return { status, connection: null, host: null, checkedAt: null, products: [], page: 1, hasMore: false,
    message: status === "disconnected" ? "No existing store is connected." : "Could not verify the store right now. Do not present old prices or stock as current. No quote, inventory, order or payment was changed." };
}

/** Current public store reads scoped to this installation's seller. No cart or order mutations. */
export function connectedStoreTools(buyer: BuyerPrincipal) {
  return {
    search_store_products: tool({
      description: "Search the seller's connected WooCommerce store for current public products, prices, stock and options. Search results are facts for you; call read_store_product for the one or two products you recommend or discuss to show their current cards. Use short product search terms; change terms or page when needed. Results are external store products, not offerIds for propose_quote. Search fresh each turn before claims about that store.",
      inputSchema: StoreSearchInput,
      execute: async (input, { abortSignal }) => {
        const store = await storeFor(buyer);
        if (!store) return failed("disconnected");
        try { return await searchWooProducts(store, input, abortSignal); }
        catch (error) { if (abortSignal?.aborted) throw error; return failed("unavailable"); }
      },
    }),
    read_store_product: tool({
      description: "Read current facts for one connected-store product by its numeric id. Shows the current product card and options. It cannot select/book a variant, hold stock, quote it locally or complete checkout.",
      inputSchema: z.object({ productId: z.number().int().positive().safe() }).strict(),
      execute: async ({ productId }, { abortSignal }): Promise<StoreResult> => {
        const store = await storeFor(buyer);
        if (!store) return failed("disconnected");
        try {
          const { product } = await readWooProduct(store, productId, abortSignal);
          return { status: "ok", connection: store.connection, host: store.host, checkedAt: new Date().toISOString(), products: [product], page: 1, hasMore: false,
            message: "Current public product. Choose options and confirm shipping, tax and final availability at the existing store checkout." };
        } catch (error) { if (abortSignal?.aborted) throw error; return failed("unavailable"); }
      },
    }),
  };
}
