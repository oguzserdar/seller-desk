import {
  fulfillmentTask,
  offer,
  orderFollowup,
  orders,
  paymentAttempt,
  quote,
  seller,
} from "@/server/db/sqlite/schema";
import {
  projectOrders,
  projectPayments,
  projectQuotes,
} from "@/server/domain/desk-view";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { createD1DigitalReads } from "./digital-read";
/** Bounded owner desk reads with shared display rules and JSON membership under D1's binding limit. */
export function createD1Desk(db: D1Db) {
  async function authorize(owner: OwnerPrincipal) {
    const [shop] = await db
      .select({ id: seller.id })
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      );
    if (!shop) throw notFound("shop");
  }
  return {
    async rows(owner: OwnerPrincipal) {
      await authorize(owner);
      const [paid, payments, quotes] = await db.batch([
        db
          .select()
          .from(orders)
          .where(eq(orders.sellerId, owner.sellerId))
          .orderBy(desc(orders.paidAt), desc(orders.id))
          .limit(500),
        db
          .select({ attempt: paymentAttempt, lines: quote.lines })
          .from(paymentAttempt)
          .innerJoin(quote, eq(quote.id, paymentAttempt.quoteId))
          .where(
            and(
              eq(paymentAttempt.sellerId, owner.sellerId),
              inArray(paymentAttempt.state, [
                "create_in_flight",
                "approval_observed",
                "capture_in_flight",
                "verification_pending",
              ]),
              isNotNull(paymentAttempt.lastError),
            ),
          )
          .orderBy(desc(paymentAttempt.updatedAt))
          .limit(200),
        db
          .select()
          .from(quote)
          .where(
            and(
              eq(quote.sellerId, owner.sellerId),
              eq(quote.status, "seller_review"),
            ),
          )
          .orderBy(desc(quote.createdAt))
          .limit(200),
      ]);
      const ids = JSON.stringify(paid.map((row) => row.id));
      const [tasks, followups] = await db.batch([
        db
          .select()
          .from(fulfillmentTask)
          .where(
            sql`${fulfillmentTask.orderId} in (select value from json_each(${ids}))`,
          ),
        db
          .select()
          .from(orderFollowup)
          .where(
            and(
              sql`${orderFollowup.orderId} in (select value from json_each(${ids}))`,
              sql`${orderFollowup.revision}=(select max(f.revision) from order_followup f where f.order_id=order_followup.order_id)`,
            ),
          ),
      ]);
      const blocks =
        await createD1DigitalReads(db).getDigitalAccessBlocks(paid);
      return [
        projectOrders(paid, tasks, followups, blocks),
        projectPayments(payments),
        projectQuotes(quotes),
      ] as const;
    },
    async images(owner: OwnerPrincipal, ids: string[]) {
      await authorize(owner);
      return db
        .select({ id: offer.id, imagePath: offer.imagePath })
        .from(offer)
        .where(
          and(
            eq(offer.sellerId, owner.sellerId),
            sql`${offer.id} in (select value from json_each(${JSON.stringify(ids)}))`,
          ),
        );
    },
  };
}
