import type { Db } from "@/server/db/client";
import {
  orders,
  paymentAttempt,
  quote,
  reservation,
  seller,
} from "@/server/db/schema";
import { notFound } from "@/server/domain/errors";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { PaymentStorage } from "../payments";

/** Native PostgreSQL reads for the shared payment driver. */
export function createPostgresPaymentReads(
  db: Db,
): Pick<
  PaymentStorage,
  | "scopedAttempt"
  | "getQuote"
  | "buyerGoods"
  | "staleHoldAttempts"
  | "reservations"
  | "orderForAttempt"
  | "dueAttempts"
> {
  return {
    async scopedAttempt(principal, id) {
      const [row] = await db
        .select({
          attempt: paymentAttempt,
          buyerSessionId: quote.buyerSessionId,
          ownerUserId: seller.ownerUserId,
        })
        .from(paymentAttempt)
        .innerJoin(quote, eq(quote.id, paymentAttempt.quoteId))
        .innerJoin(seller, eq(seller.id, paymentAttempt.sellerId))
        .where(eq(paymentAttempt.id, id));
      if (
        !row ||
        (principal.kind === "buyer" &&
          (row.buyerSessionId !== principal.buyerSessionId ||
            row.attempt.sellerId !== principal.sellerId)) ||
        (principal.kind === "owner" &&
          (row.attempt.sellerId !== principal.sellerId ||
            row.ownerUserId !== principal.userId))
      )
        throw notFound("payment");
      return row.attempt;
    },
    async getQuote(id) {
      return (await db.select().from(quote).where(eq(quote.id, id)))[0];
    },
    async buyerGoods(buyer, id) {
      const [row] = await db
        .select({ lines: quote.lines })
        .from(quote)
        .where(
          and(
            eq(quote.id, id),
            eq(quote.buyerSessionId, buyer.buyerSessionId),
            eq(quote.sellerId, buyer.sellerId),
          ),
        );
      return (
        row?.lines
          .filter((line) => line.kind === "goods")
          .map((line) => line.offerId) ?? []
      );
    },
    async staleHoldAttempts(ids, limit) {
      if (!ids.length) return [];
      const rows = await db
        .selectDistinct({ id: paymentAttempt.id })
        .from(reservation)
        .innerJoin(
          paymentAttempt,
          eq(paymentAttempt.quoteId, reservation.quoteId),
        )
        .where(
          and(
            inArray(reservation.offerId, ids),
            eq(reservation.state, "held"),
            lt(reservation.expiresAt, sql`now()`),
            inArray(paymentAttempt.state, [
              "order_created",
              "approval_observed",
            ]),
          ),
        )
        .limit(limit);
      return rows.map((row) => row.id);
    },
    async reservations(id) {
      return db
        .select({ state: reservation.state, expiresAt: reservation.expiresAt })
        .from(reservation)
        .where(eq(reservation.quoteId, id));
    },
    async orderForAttempt(id) {
      return (
        (
          await db
            .select({ id: orders.id, number: orders.number })
            .from(orders)
            .where(eq(orders.paymentAttemptId, id))
        )[0] ?? null
      );
    },
    async dueAttempts(limit) {
      return (
        await db
          .select({ id: paymentAttempt.id })
          .from(paymentAttempt)
          .where(
            and(
              inArray(paymentAttempt.state, [
                "planned",
                "create_in_flight",
                "order_created",
                "approval_observed",
                "capture_in_flight",
                "verification_pending",
              ]),
              lt(paymentAttempt.nextCheckAt, sql`now()`),
            ),
          )
          .orderBy(paymentAttempt.nextCheckAt)
          .limit(limit)
      ).map((row) => row.id);
    },
  };
}
