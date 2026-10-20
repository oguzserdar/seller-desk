import { getStorage } from "@/server/storage";
/**
 * What a buyer may see about their own purchases: recent orders with what is
 * still to do, and payments PayPal has not confirmed. The buyer agent reads
 * this to help after checkout. Every read is scoped to this buyer's session.
 */
import { formatMoney } from "@/lib/money";
import type { OrderFollowupView } from "@/lib/order-followup";
import { getDb } from "@/server/db/client";
import { orders, paymentAttempt, quote } from "@/server/db/schema";
import { getPaymentView } from "@/server/payments/engine";
import { and, desc, eq, ne } from "drizzle-orm";
import { getBuyerOrder } from "./orders";
import type { BuyerPrincipal } from "./principal";

/** Buyer-scoped records and internal tool handles, never a provider credential. */
export type BuyerPurchases = {
  /** A recorded seller action cannot prove facts this installation does not collect or share. */
  recordLimits: {
    customerAcceptance: "not_collected";
    appointmentDateTime: "not_shared";
  };
  orders: {
    orderId: string;
    paymentId: string;
    number: number;
    paidAt: string;
    items: string;
    total: string;
    stillToDo: string[];
    fulfillment: { label: string; detail: string }[];
    downloadsReady: number;
    help: OrderFollowupView;
  }[];
  /** Payments that are not (or not yet) paid, with the engine's own words for their state. */
  otherPayments: {
    paymentId: string;
    amount: string;
    state: string;
    status: string;
    detail: string;
  }[];
};

export async function listBuyerPurchases(
  buyer: BuyerPrincipal,
): Promise<BuyerPurchases> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.purchases.listBuyerPurchases(buyer);
  const db = getDb();
  const [orderRows, attemptRows] = await Promise.all([
    db
      .select({ id: orders.id, paymentId: orders.paymentAttemptId })
      .from(orders)
      .where(
        and(
          eq(orders.buyerSessionId, buyer.buyerSessionId),
          eq(orders.sellerId, buyer.sellerId),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(5),
    db
      .select({ id: paymentAttempt.id })
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
  const [orderViews, paymentViews] = await Promise.all([
    Promise.all(
      orderRows.map(async (row) => ({
        view: await getBuyerOrder({ buyer, key: null }, row.id),
        paymentId: row.paymentId,
      })),
    ),
    Promise.all(attemptRows.map((row) => getPaymentView(buyer, row.id))),
  ]);
  return {
    recordLimits: {
      customerAcceptance: "not_collected",
      appointmentDateTime: "not_shared",
    },
    orders: orderViews.map(({ view, paymentId }) => ({
      orderId: view.id,
      paymentId,
      number: view.number,
      paidAt: view.paidAt,
      items: view.snapshot.lines
        .map((line) => `${line.quantity} x ${line.title}`)
        .join(", "),
      total: formatMoney(view.snapshot.totalMinor, view.snapshot.currency),
      stillToDo: view.tasks
        .filter((task) => task.state !== "completed")
        .map((task) => `${task.label}: ${task.detail}`),
      fulfillment: view.tasks.map(({ label, detail }) => ({ label, detail })),
      downloadsReady: view.downloads.length,
      help: view.followup,
    })),
    otherPayments: paymentViews.map((view) => ({
      paymentId: view.attemptId,
      amount: view.amount,
      state: view.state,
      status: view.headline,
      detail: view.detail,
    })),
  };
}
