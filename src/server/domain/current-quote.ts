import { getDb } from "@/server/db/client";
import { quote } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { and, desc, eq } from "drizzle-orm";
import type { BuyerPrincipal } from "./principal";
import { getBuyerQuote, type BuyerQuoteView } from "./quotes";

/** Restores the buyer's latest quote from either manual or AI input, without reviving cancelled work. */
export async function getCurrentBuyerQuote(
  buyer: BuyerPrincipal,
): Promise<BuyerQuoteView | null> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.quotes.getCurrentBuyerQuote(buyer);

  const [latest] = await getDb()
    .select({ id: quote.id, status: quote.status })
    .from(quote)
    .where(
      and(
        eq(quote.buyerSessionId, buyer.buyerSessionId),
        eq(quote.sellerId, buyer.sellerId),
      ),
    )
    .orderBy(desc(quote.createdAt), desc(quote.revision))
    .limit(1);
  if (!latest || latest.status === "cancelled") return null;
  return getBuyerQuote(buyer, latest.id);
}
