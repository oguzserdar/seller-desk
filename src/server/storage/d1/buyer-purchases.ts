import { formatMoney } from "@/lib/money";
import {
  accessGrant,
  fulfillmentTask,
  orderFollowup,
  orders,
  paymentAttempt,
  quote,
} from "@/server/db/sqlite/schema";
import type { BuyerPurchases } from "@/server/domain/buyer-purchases";
import { describeTask } from "@/server/domain/orders";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { describeAttempt } from "@/server/payments/engine";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { D1Db } from "./client";
import { createD1DigitalReads } from "./digital-read";
import { followupView } from "./order-followup";

/** Native purchase context uses bounded bulk reads rather than one query chain per order. */
export function createD1BuyerPurchases(db: D1Db) {
  return {
    async listBuyerPurchases(buyer: BuyerPrincipal): Promise<BuyerPurchases> {
      const scope = and(
        eq(orders.buyerSessionId, buyer.buyerSessionId),
        eq(orders.sellerId, buyer.sellerId),
      );
      const recent = db
        .select({ id: orders.id })
        .from(orders)
        .where(scope)
        .orderBy(desc(orders.createdAt))
        .limit(5);
      const ranked = db.$with("ranked_help").as(
        db
          .select({
            ...getTableColumns(orderFollowup),
            rank: sql<number>`row_number() over(partition by ${orderFollowup.orderId} order by ${orderFollowup.revision} desc)`.as(
              "rn",
            ),
          })
          .from(orderFollowup)
          .where(inArray(orderFollowup.orderId, recent)),
      );
      const [paid, tasks, grants, help, payments] = await db.batch([
        db
          .select()
          .from(orders)
          .where(scope)
          .orderBy(desc(orders.createdAt))
          .limit(5),
        db
          .select()
          .from(fulfillmentTask)
          .where(inArray(fulfillmentTask.orderId, recent))
          .orderBy(asc(fulfillmentTask.createdAt)),
        db
          .select()
          .from(accessGrant)
          .where(inArray(accessGrant.orderId, recent)),
        db
          .with(ranked)
          .select()
          .from(ranked)
          .where(lte(ranked.rank, 21))
          .orderBy(desc(ranked.revision)),
        db
          .select({ attempt: paymentAttempt })
          .from(paymentAttempt)
          .innerJoin(quote, eq(quote.id, paymentAttempt.quoteId))
          .where(
            and(
              eq(quote.buyerSessionId, buyer.buyerSessionId),
              eq(paymentAttempt.sellerId, buyer.sellerId),
              ne(paymentAttempt.state, "paid"),
            ),
          )
          .orderBy(desc(paymentAttempt.createdAt))
          .limit(5),
      ]);
      const blocks =
        await createD1DigitalReads(db).getDigitalAccessBlocks(paid);
      return {
        recordLimits: {
          customerAcceptance: "not_collected",
          appointmentDateTime: "not_shared",
        },
        orders: paid.map((order) => {
          const own = tasks.filter((task) => task.orderId === order.id),
            ownGrants = grants.filter((grant) => grant.orderId === order.id),
            available = ownGrants.filter(
              (grant) =>
                grant.state === "active" && grant.expiresAt > new Date(),
            ),
            ended = available.length < ownGrants.length,
            block = blocks.get(order.id);
          const states = own.map((task) => ({
            state: task.state,
            ...(task.type === "digital_access" && (ended || block)
              ? {
                  label:
                    block?.code === "invalid" && !ownGrants.length
                      ? "Download needs seller review"
                      : available.length
                        ? "Some download access has ended"
                        : "Download access ended",
                  detail:
                    "Contact the seller to review access. You do not need to pay again to ask for help.",
                }
              : describeTask(task)),
          }));
          return {
            orderId: order.id,
            paymentId: order.paymentAttemptId,
            number: order.number,
            paidAt: order.paidAt.toISOString(),
            items: order.snapshot.lines
              .map((line) => `${line.quantity} x ${line.title}`)
              .join(", "),
            total: formatMoney(
              order.snapshot.totalMinor,
              order.snapshot.currency,
            ),
            stillToDo: states
              .filter((task) => task.state !== "completed")
              .map((task) => `${task.label}: ${task.detail}`),
            fulfillment: states.map(({ label, detail }) => ({ label, detail })),
            downloadsReady: available.length,
            help: followupView(
              help.filter((item) => item.orderId === order.id),
            ),
          };
        }),
        otherPayments: payments.map(({ attempt }) => {
          const view = describeAttempt(attempt, null);
          return {
            paymentId: attempt.id,
            amount: view.amount,
            state: view.state,
            status: view.headline,
            detail: view.detail,
          };
        }),
      };
    },
  };
}
