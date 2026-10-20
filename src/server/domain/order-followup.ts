import {
  BuyerOrderFollowupInput,
  ReplyOrderFollowupInput,
} from "@/lib/order-followup";
import { getDb, transaction, type Tx } from "@/server/db/client";
import { orderFollowup, orders, seller } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import { readOrderFollowup } from "./order-followup-read";
import { checkOrderAccessKey } from "./orders";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

type Event = {
  orderId: string;
  expectedRevision: number;
  state: "needs_help" | "awaiting_customer" | "confirmed";
  actor: "buyer" | "owner";
  actorId: string;
  message: string;
};

/** Caller holds this order's row lock, so competing app processes serialize here. */
async function append(tx: Tx, input: Event) {
  const [current] = await tx
    .select()
    .from(orderFollowup)
    .where(eq(orderFollowup.orderId, input.orderId))
    .orderBy(desc(orderFollowup.revision))
    .limit(1);
  const revision = current?.revision ?? 0;
  if (
    revision === input.expectedRevision + 1 &&
    current?.actor === input.actor &&
    current.state === input.state &&
    current.message === input.message
  ) {
    return readOrderFollowup(tx, input.orderId);
  }
  if (revision !== input.expectedRevision)
    throw conflict(
      "This order has a newer message. Your words are still here; check the latest reply before sending again.",
    );
  if (input.state === "awaiting_customer" && current?.state !== "needs_help")
    throw conflict("There is no unanswered customer problem on this order.");
  if (
    input.state === "confirmed" &&
    (!current || current.state === "confirmed")
  )
    throw conflict("There is no open problem to confirm.");
  await tx
    .insert(orderFollowup)
    .values({
      orderId: input.orderId,
      revision: revision + 1,
      actor: input.actor,
      state: input.state,
      message: input.message,
    });
  await recordAudit(tx, {
    actor: input.actor,
    actorId: input.actorId,
    operation: `order_help.${input.state}`,
    targetType: "order",
    targetId: input.orderId,
    outcome: "ok",
    details: { revision: revision + 1 },
  });
  return readOrderFollowup(tx, input.orderId);
}

/** Buyer button action: retain a problem or explicitly confirm its resolution. Never called by an AI tool. */
export async function buyerOrderFollowup(
  access: { buyer: BuyerPrincipal | null; key: string | null },
  raw: z.input<typeof BuyerOrderFollowupInput>,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.buyerOrderFollowup(access, raw);

  const input = BuyerOrderFollowupInput.parse(raw);
  if (access.buyer?.assistantTurn)
    throw invalid(
      "The customer must send or confirm this directly from their order.",
    );
  return transaction(getDb(), async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .for("update");
    const sessionMatches =
      order &&
      access.buyer?.buyerSessionId === order.buyerSessionId &&
      access.buyer?.sellerId === order.sellerId;
    if (
      !order ||
      (!sessionMatches && !checkOrderAccessKey(order.id, access.key))
    )
      throw notFound("order");
    return append(tx, {
      orderId: order.id,
      expectedRevision: input.expectedRevision,
      actor: "buyer",
      actorId: sessionMatches ? access.buyer!.buyerSessionId : "order-link",
      state: input.action === "help" ? "needs_help" : "confirmed",
      message: input.action === "help" ? input.message : "",
    });
  });
}

/** Owner reply stays open for the buyer. It cannot confirm resolution, grant access or alter payment. */
export async function replyOrderFollowup(
  owner: OwnerPrincipal,
  raw: z.input<typeof ReplyOrderFollowupInput>,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.replyOrderFollowup(owner, raw);

  const input = ReplyOrderFollowupInput.parse(raw);
  return transaction(getDb(), async (tx) => {
    const [shop] = await tx
      .select({ id: seller.id })
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      );
    if (!shop) throw notFound("order");
    const [order] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.sellerId, shop.id)))
      .for("update");
    if (!order) throw notFound("order");
    return append(tx, {
      ...input,
      actor: "owner",
      actorId: owner.userId,
      state: "awaiting_customer",
    });
  });
}
