import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  quote,
  seller,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import {
  ServiceQuoteReview,
  effectiveStatus,
  type QuoteRow,
} from "@/server/domain/quotes";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { createD1CatalogReads } from "./catalog-read";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { d1QuotePlan } from "./quote-plan";

/** Explicit seller scope/price review creates a new buyer-reviewed quote, never a payment. */
export function createD1QuoteApproval(db: D1Db) {
  return {
    async approveQuoteScope(
      owner: OwnerPrincipal,
      raw: z.input<typeof ServiceQuoteReview>,
    ): Promise<QuoteRow> {
      const parsed = ServiceQuoteReview.safeParse(raw);
      if (!parsed.success)
        throw invalid(
          "Provide the confirmed scope and a valid price for each custom service.",
        );
      const input = parsed.data;
      const [shop] = await db
        .select()
        .from(seller)
        .where(
          and(
            eq(seller.id, owner.sellerId),
            eq(seller.ownerUserId, owner.userId),
          ),
        );
      if (!shop) throw notFound("shop");
      const [row] = await db
        .select()
        .from(quote)
        .where(
          and(eq(quote.id, input.quoteId), eq(quote.sellerId, owner.sellerId)),
        );
      if (!row) throw notFound("quote");
      if (row.revision !== input.expectedRevision)
        throw conflict(
          "This quote changed after you opened it. Review it again.",
        );
      const [latest] = await db
        .select({ id: quote.id })
        .from(quote)
        .where(eq(quote.threadId, row.threadId))
        .orderBy(desc(quote.revision))
        .limit(1);
      if (latest?.id !== row.id)
        throw conflict(
          "The buyer has a newer version of this quote. Review that one.",
        );
      if (effectiveStatus(row) !== "seller_review")
        throw conflict("This quote is not waiting for your review.");
      const unpriced = row.lines.filter(
          (line) => line.unitAmountMinor === null,
        ),
        prices = new Map(
          input.prices.map((price) => [price.offerId, price.unitAmountMinor]),
        );
      if (
        prices.size !== input.prices.length ||
        prices.size !== unpriced.length ||
        unpriced.some((line) => !prices.has(line.offerId))
      )
        throw invalid(
          "Set one price for each custom service. Fixed catalog prices cannot be changed here.",
        );
      const rows = await createD1CatalogReads(db).loadOffersForQuote(
        owner.sellerId,
        row.lines.map((line) => line.offerId),
      );
      if (
        row.lines.some((line) => {
          const current = rows.find(
            ({ offer }) => offer.id === line.offerId,
          )?.offer;
          return (
            !current?.published ||
            current.revision !== line.offerRevision ||
            current.unitAmountMinor !== line.unitAmountMinor
          );
        })
      )
        throw conflict(
          "An offer changed after this request. The buyer needs a fresh quote.",
        );
      const plan = d1QuotePlan(db, {
        shop,
        rows,
        buyerSessionId: row.buyerSessionId,
        threadId: row.threadId,
        revision: row.revision + 1,
        request: {
          lines: row.lines.map((line) => ({
            offerId: line.offerId,
            quantity: line.quantity,
          })),
          buyerNote: row.buyerNote ?? undefined,
          budgetMinor: row.budgetMinor,
          deliveryRequested: row.deliveryRequested,
        },
        scopeApproved: true,
        approvedScope: input.approvedScope,
        sellerPrices: prices,
      });
      if (input.answer) {
        const [question] = await db
          .select({ id: sellerQuestion.id })
          .from(sellerQuestion)
          .where(
            and(
              eq(sellerQuestion.id, input.answer.questionId),
              eq(sellerQuestion.sellerId, owner.sellerId),
              eq(sellerQuestion.buyerSessionId, row.buyerSessionId),
            ),
          );
        if (!question) throw notFound("question");
      }
      const execution = crypto.randomUUID();
      try {
        const results = await db.batch([
          batchGuard(
            db,
            `${execution}:review`,
            sql`${ownerScope(owner)} and ${plan.valid}
          and exists(select 1 from quote where id=${row.id} and seller_id=${owner.sellerId} and revision=${row.revision} and status='seller_review' and expires_at>${nowMilliseconds})
          and not exists(select 1 from quote where thread_id=${row.threadId} and revision>${row.revision})
          and ${input.answer ? sql`exists(select 1 from seller_question where id=${input.answer.questionId} and seller_id=${owner.sellerId} and buyer_session_id=${row.buyerSessionId} and state='open' and revision=${input.answer.expectedRevision})` : sql`1`}`,
          ),
          ...(input.answer
            ? [
                db
                  .update(sellerQuestion)
                  .set({
                    state: "answered",
                    answer: input.answer.answer,
                    answeredAt: new Date(),
                    revision: input.answer.expectedRevision + 1,
                  })
                  .where(eq(sellerQuestion.id, input.answer.questionId)),
                db
                  .insert(auditEvent)
                  .values({
                    actor: "owner",
                    actorId: owner.userId,
                    operation: "answer_seller_question",
                    targetType: "seller_question",
                    targetId: input.answer.questionId,
                    outcome: "ok",
                  }),
              ]
            : []),
          ...plan.writes,
          db
            .update(quote)
            .set({ status: "replaced" })
            .where(eq(quote.id, row.id)),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "quote.approve_scope",
              targetType: "quote",
              targetId: plan.row.id,
              outcome: "ok",
              details: { fromRevision: row.revision, status: plan.row.status },
            }),
          db.select().from(quote).where(eq(quote.id, plan.row.id)),
          clearBatchGuards(db, execution),
        ]);
        return (results[results.length - 2] as QuoteRow[])[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "The quote, seller request or catalog changed. Review the latest version.",
          );
        throw error;
      }
    },
  };
}
