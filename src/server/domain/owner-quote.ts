import { getDb } from "@/server/db/client";
import { offer, quote, seller, sellerQuestion } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { and, eq } from "drizzle-orm";
import { notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";
import { effectiveStatus } from "./quotes";
/** Scoped quote review facts for server rendering, identical to the assistant's seller decision boundary. */
export async function readOwnerQuoteReview(owner: OwnerPrincipal, id: string) {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.quotes.ownerReview(owner, id);
  const db = getDb(),
    [row] = await db
      .select({ quote })
      .from(quote)
      .innerJoin(
        seller,
        and(
          eq(seller.id, quote.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      )
      .where(and(eq(quote.id, id), eq(quote.sellerId, owner.sellerId)));
  if (!row) throw notFound("quote");
  const current = row.quote,
    status = effectiveStatus(current);
  const [pendingQuestion] =
    status === "seller_review"
      ? await db
          .select({
            id: sellerQuestion.id,
            revision: sellerQuestion.revision,
            question: sellerQuestion.question,
          })
          .from(sellerQuestion)
          .where(
            and(
              eq(sellerQuestion.sellerId, owner.sellerId),
              eq(sellerQuestion.buyerSessionId, current.buyerSessionId),
              eq(sellerQuestion.state, "open"),
            ),
          )
          .orderBy(sellerQuestion.createdAt, sellerQuestion.id)
          .limit(1)
      : [];
  const serviceLine = current.lines.find((line) => line.kind === "service");
  const [serviceOffer] = serviceLine
    ? await db
        .select({ scope: offer.serviceScope })
        .from(offer)
        .where(
          and(
            eq(offer.id, serviceLine.offerId),
            eq(offer.sellerId, owner.sellerId),
          ),
        )
    : [];
  return { row: current, status, pendingQuestion, serviceLine, serviceOffer };
}
