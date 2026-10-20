import {
  fulfillmentTask,
  orders,
  paymentAttempt,
  quote,
} from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { effectiveStatus, type BuyerQuoteView } from "@/server/domain/quotes";
import { and, desc, eq } from "drizzle-orm";
import type { D1Db } from "./client";

/** Internal quote projection; caller must first establish buyer or owner scope. */
export async function d1BuyerQuoteView(
  db: D1Db,
  row: typeof quote.$inferSelect,
): Promise<BuyerQuoteView> {
  const [latestRows, attempts, paidRows, tasks] = await db.batch([
    db
      .select({ id: quote.id })
      .from(quote)
      .where(eq(quote.threadId, row.threadId))
      .orderBy(desc(quote.revision))
      .limit(1),
    db
      .select({
        id: paymentAttempt.id,
        state: paymentAttempt.state,
        approvalUrl: paymentAttempt.approvalUrl,
      })
      .from(paymentAttempt)
      .where(eq(paymentAttempt.quoteId, row.id)),
    db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(eq(orders.quoteId, row.id)),
    db
      .select({ type: fulfillmentTask.type, state: fulfillmentTask.state })
      .from(fulfillmentTask)
      .innerJoin(orders, eq(orders.id, fulfillmentTask.orderId))
      .where(eq(orders.quoteId, row.id)),
  ]);
  const latest = latestRows[0],
    attempt = attempts[0],
    paid = paidRows[0],
    isLatest = latest?.id === row.id,
    status = effectiveStatus(row);
  const next = !isLatest
    ? ["open_latest"]
    : attempt
      ? ["check_payment"]
      : status === "review_ready"
        ? ["accept_and_pay", "revise", "cancel"]
        : status === "needs_information"
          ? ["revise", "cancel"]
          : status === "seller_review"
            ? ["wait_for_seller", "cancel"]
            : status === "expired"
              ? ["requote"]
              : [];
  return {
    id: row.id,
    threadId: row.threadId,
    revision: row.revision,
    status,
    lines: row.lines,
    charges: row.charges,
    unresolved: row.unresolved,
    subtotalMinor: row.subtotalMinor,
    totalMinor: row.totalMinor,
    currency: row.currency,
    expiresAt: row.expiresAt.toISOString(),
    policy: row.policySnapshot,
    approvedScope: row.approvedScope,
    reviewReason: row.reviewReason,
    buyerNote: row.buyerNote,
    budgetMinor: row.budgetMinor,
    deliveryRequested: row.deliveryRequested,
    isLatest,
    latestQuoteId: latest?.id ?? row.id,
    payment: attempt
      ? {
          attemptId: attempt.id,
          state: attempt.state,
          approvalUrl:
            attempt.state === "order_created" ? attempt.approvalUrl : null,
        }
      : null,
    order: paid ? { ...paid, tasks } : null,
    next,
  };
}

/** Native buyer quote reads hide other buyers' lookup keys. */
export function createD1QuoteReads(db: D1Db) {
  const getBuyerQuote = async (buyer: BuyerPrincipal, id: string) => {
    const [row] = await db
      .select()
      .from(quote)
      .where(
        and(
          eq(quote.id, id),
          eq(quote.buyerSessionId, buyer.buyerSessionId),
          eq(quote.sellerId, buyer.sellerId),
        ),
      );
    if (!row) throw notFound("quote");
    return d1BuyerQuoteView(db, row);
  };
  return {
    async openQuote(buyer: BuyerPrincipal) {
      const [row] = await db
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.buyerSessionId, buyer.buyerSessionId),
            eq(quote.sellerId, buyer.sellerId),
          ),
        )
        .orderBy(desc(quote.createdAt))
        .limit(1);
      return row &&
        ["review_ready", "needs_information", "seller_review"].includes(
          effectiveStatus(row),
        )
        ? row
        : undefined;
    },
    getBuyerQuote,
    async getCurrentBuyerQuote(
      buyer: BuyerPrincipal,
    ): Promise<BuyerQuoteView | null> {
      const [latest] = await db
        .select()
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
      return d1BuyerQuoteView(db, latest);
    },
  };
}
