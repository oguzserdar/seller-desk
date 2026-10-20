import { offer, quote, sellerQuestion } from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { effectiveStatus } from "@/server/domain/quotes";
import { and, eq } from "drizzle-orm";
import type { D1Db } from "./client";
import { ownerScope } from "./guards";
/** Native quote review facts are read only after proving current ownership. */
export async function readD1OwnerQuoteReview(
  db: D1Db,
  owner: OwnerPrincipal,
  id: string,
) {
  const [row] = await db
    .select()
    .from(quote)
    .where(
      and(
        eq(quote.id, id),
        eq(quote.sellerId, owner.sellerId),
        ownerScope(owner),
      ),
    );
  if (!row) throw notFound("quote");
  const status = effectiveStatus(row);
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
              eq(sellerQuestion.buyerSessionId, row.buyerSessionId),
              eq(sellerQuestion.state, "open"),
            ),
          )
          .orderBy(sellerQuestion.createdAt, sellerQuestion.id)
          .limit(1)
      : [];
  const serviceLine = row.lines.find((line) => line.kind === "service");
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
  return { row, status, pendingQuestion, serviceLine, serviceOffer };
}
