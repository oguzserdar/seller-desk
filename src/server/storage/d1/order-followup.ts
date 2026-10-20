import {
  BuyerOrderFollowupInput,
  ReplyOrderFollowupInput,
  type OrderFollowupView,
} from "@/lib/order-followup";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import { auditEvent, orderFollowup, orders } from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import { checkOrderAccessKey } from "@/server/domain/orders";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

type Row = typeof orderFollowup.$inferSelect;
/** Shared display semantics for native order-help history. */
export function followupView(rows: Row[]): OrderFollowupView {
  const latest = rows[0];
  return {
    state: latest?.state ?? "none",
    revision: latest?.revision ?? 0,
    nextActor:
      latest?.state === "needs_help"
        ? "seller"
        : latest?.state === "awaiting_customer"
          ? "buyer"
          : null,
    history: rows
      .slice(0, 20)
      .reverse()
      .map((row) => ({
        revision: row.revision,
        actor: row.actor,
        state: row.state,
        message: row.message,
        at: row.createdAt.toISOString(),
      })),
    earlierMessages: rows.length > 20,
  };
}
/** Internal projection, called only after access to the order has been established. */
export async function readD1OrderFollowup(
  db: D1Db,
  orderId: string,
): Promise<OrderFollowupView> {
  return followupView(
    await db
      .select()
      .from(orderFollowup)
      .where(eq(orderFollowup.orderId, orderId))
      .orderBy(desc(orderFollowup.revision))
      .limit(21),
  );
}

type Event = {
  orderId: string;
  expectedRevision: number;
  actor: "buyer" | "owner";
  actorId: string;
  state: "needs_help" | "awaiting_customer" | "confirmed";
  message: string;
};
async function append(
  db: D1Db,
  event: Event,
  authority: SQL,
): Promise<OrderFollowupView> {
  const [current] = await db
    .select()
    .from(orderFollowup)
    .where(eq(orderFollowup.orderId, event.orderId))
    .orderBy(desc(orderFollowup.revision))
    .limit(1);
  const revision = current?.revision ?? 0;
  if (
    revision === event.expectedRevision + 1 &&
    current?.actor === event.actor &&
    current.state === event.state &&
    current.message === event.message
  )
    return readD1OrderFollowup(db, event.orderId);
  if (revision !== event.expectedRevision)
    throw conflict(
      "This order has a newer message. Your words are still here; check the latest reply before sending again.",
    );
  if (event.state === "awaiting_customer" && current?.state !== "needs_help")
    throw conflict("There is no unanswered customer problem on this order.");
  if (
    event.state === "confirmed" &&
    (!current || current.state === "confirmed")
  )
    throw conflict("There is no open problem to confirm.");
  const execution = crypto.randomUUID();
  try {
    const [, , , rows] = await db.batch([
      batchGuard(
        db,
        `${execution}:help`,
        sql`${authority} and coalesce((select max(revision) from order_followup where order_id=${event.orderId}),0)=${revision}`,
      ),
      db
        .insert(orderFollowup)
        .values({
          orderId: event.orderId,
          revision: revision + 1,
          actor: event.actor,
          state: event.state,
          message: event.message,
        }),
      db
        .insert(auditEvent)
        .values({
          actor: event.actor,
          actorId: event.actorId,
          operation: `order_help.${event.state}`,
          targetType: "order",
          targetId: event.orderId,
          outcome: "ok",
          details: { revision: revision + 1 },
        }),
      db
        .select()
        .from(orderFollowup)
        .where(eq(orderFollowup.orderId, event.orderId))
        .orderBy(desc(orderFollowup.revision))
        .limit(21),
      clearBatchGuards(db, execution),
    ]);
    return followupView(rows);
  } catch (error) {
    if (isBatchGuardFailure(error))
      throw conflict(
        "This order has a newer message. Your words are still here; check the latest reply before sending again.",
      );
    throw error;
  }
}

/** Buyer confirmations and seller replies remain independent of payment and fulfilment. */
export function createD1OrderFollowup(db: D1Db) {
  return {
    async buyerOrderFollowup(
      access: { buyer: BuyerPrincipal | null; key: string | null },
      raw: z.input<typeof BuyerOrderFollowupInput>,
    ) {
      const input = BuyerOrderFollowupInput.parse(raw);
      if (access.buyer?.assistantTurn)
        throw invalid(
          "The customer must send or confirm this directly from their order.",
        );
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId));
      const session =
        order &&
        access.buyer?.buyerSessionId === order.buyerSessionId &&
        access.buyer?.sellerId === order.sellerId;
      if (!order || (!session && !checkOrderAccessKey(order.id, access.key)))
        throw notFound("order");
      const authority = sql`exists(select 1 from orders where id=${order.id} and ${session ? sql`buyer_session_id=${access.buyer!.buyerSessionId} and seller_id=${access.buyer!.sellerId}` : sql`${Number(access.key!.split(".")[0])}>${nowMilliseconds}`})`;
      return append(
        db,
        {
          orderId: order.id,
          expectedRevision: input.expectedRevision,
          actor: "buyer",
          actorId: session ? access.buyer!.buyerSessionId : "order-link",
          state: input.action === "help" ? "needs_help" : "confirmed",
          message: input.action === "help" ? input.message : "",
        },
        authority,
      );
    },
    async replyOrderFollowup(
      owner: OwnerPrincipal,
      raw: z.input<typeof ReplyOrderFollowupInput>,
    ) {
      const input = ReplyOrderFollowupInput.parse(raw);
      const [order] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!order) throw notFound("order");
      return append(
        db,
        {
          ...input,
          actor: "owner",
          actorId: owner.userId,
          state: "awaiting_customer",
        },
        sql`${ownerScope(owner)} and exists(select 1 from orders where id=${order.id} and seller_id=${owner.sellerId})`,
      );
    },
  };
}
