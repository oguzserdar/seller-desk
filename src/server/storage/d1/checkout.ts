import { hashPayload } from "@/server/crypto";
import { nowMilliseconds, uuidDefault } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  inventory,
  paymentAttempt,
  quote,
  reservation,
  seller,
} from "@/server/db/sqlite/schema";
import { AssistantTurnEnded } from "@/server/domain/assistant-turn";
import { conflict, DomainError, notFound } from "@/server/domain/errors";
import { assertQuotePriced } from "@/server/domain/priced-quote";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { buildCreateRequest } from "@/server/payments/create-request";
import { and, eq, sql } from "drizzle-orm";
import type {
  CheckoutContext,
  CheckoutInput,
  CheckoutStorage,
} from "../checkout";
import type { D1Db } from "./client";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
} from "./guards";

type QuoteRow = typeof quote.$inferSelect;

async function assertLiveScope(db: D1Db, buyer: BuyerPrincipal): Promise<void> {
  const [scope] = await db
    .select({ id: seller.id })
    .from(seller)
    .where(and(eq(seller.id, buyer.sellerId), buyerScope(buyer)));
  if (!scope) {
    if (buyer.assistantTurn) throw new AssistantTurnEnded();
    throw notFound("quote");
  }
}

async function existingIntent(
  db: D1Db,
  buyer: BuyerPrincipal,
  quoteId: string,
): Promise<string | undefined> {
  const execution = crypto.randomUUID();
  const [, rows] = await db.batch([
    batchGuard(db, `${execution}:scope`, buyerScope(buyer)),
    db
      .select({ id: paymentAttempt.id })
      .from(paymentAttempt)
      .innerJoin(quote, eq(quote.id, paymentAttempt.quoteId))
      .where(
        and(
          eq(quote.id, quoteId),
          eq(quote.sellerId, buyer.sellerId),
          eq(quote.buyerSessionId, buyer.buyerSessionId),
        ),
      ),
    clearBatchGuards(db, execution),
  ]);
  return rows[0]?.id;
}

async function reserve(
  db: D1Db,
  buyer: BuyerPrincipal,
  input: CheckoutInput,
  context: CheckoutContext,
  row: QuoteRow,
): Promise<string> {
  assertQuotePriced(row);
  const [shop] = await db
    .select()
    .from(seller)
    .where(eq(seller.id, buyer.sellerId));
  if (!shop) throw notFound("shop");
  if (shop.policyRevision !== row.policySnapshot.policyRevision)
    throw conflict(
      "The seller updated their terms after this quote. Ask for an updated quote.",
      ["requote"],
    );
  const id = crypto.randomUUID();
  const execution = crypto.randomUUID();
  const createRequestId = crypto.randomUUID();
  const request = buildCreateRequest({
    attemptId: id,
    createRequestId,
    quoteRow: row,
    amountMinor: row.totalMinor,
    currency: row.currency,
    payeeMerchantId: context.payeeMerchantId,
    appUrl: context.appUrl,
  });
  // Every fact read before this batch is checked again in the batch. D1 batches
  // serialize those checks and effects together; no BEGIN callback is used.
  const valid = sql`exists(select 1 from quote q join seller s on s.id=q.seller_id
    where q.id=${row.id} and q.seller_id=${buyer.sellerId} and q.buyer_session_id=${buyer.buyerSessionId}
    and q.revision=${input.revision} and q.status='review_ready' and q.expires_at > ${nowMilliseconds}
    and q.lines=${JSON.stringify(row.lines)} and q.charges=${JSON.stringify(row.charges)}
    and q.total_minor=${row.totalMinor} and q.currency=${row.currency}
    and s.policy_revision=${shop.policyRevision} and s.hold_ttl_minutes=${shop.holdTtlMinutes}
    and not exists(select 1 from quote newer where newer.thread_id=q.thread_id and newer.revision>q.revision)
    and not exists(select 1 from payment_attempt p where p.quote_id=q.id)
    and not exists(select 1 from json_each(q.lines) l left join offer o on o.id=json_extract(l.value,'$.offerId') and o.seller_id=q.seller_id
      where o.id is null or o.published<>1 or o.revision<>json_extract(l.value,'$.offerRevision')
      or (o.unit_amount_minor is not null and o.unit_amount_minor<>json_extract(l.value,'$.unitAmountMinor'))
      or (o.unit_amount_minor is null and (o.kind<>'service' or o.requires_scope_review<>1 or q.seller_approved_at is null or q.approved_scope is null)))
    and not exists(select 1 from json_each(q.lines) l left join inventory i on i.offer_id=json_extract(l.value,'$.offerId')
      where json_extract(l.value,'$.kind')='goods' and (i.offer_id is null or i.total-i.held-i.sold<json_extract(l.value,'$.quantity'))))`;
  const holdUntil = new Date(Date.now() + shop.holdTtlMinutes * 60_000);
  const goods = row.lines
    .filter((line) => line.kind === "goods")
    .sort((a, b) => a.offerId.localeCompare(b.offerId));
  await db.batch([
    batchGuard(db, `${execution}:scope`, buyerScope(buyer)),
    batchGuard(db, `${execution}:quote`, valid),
    ...(goods.length
      ? [
          db
            .update(inventory)
            .set({
              held: sql`${inventory.held}+(select json_extract(j.value,'$.quantity') from json_each(${JSON.stringify(goods)}) j where json_extract(j.value,'$.offerId')=inventory.offer_id)`,
            })
            .where(
              sql`${inventory.offerId} in (select json_extract(j.value,'$.offerId') from json_each(${JSON.stringify(goods)}) j)`,
            ),
          db
            .insert(reservation)
            .select(
              db
                .select({
                  id: uuidDefault.as("id"),
                  offerId: sql<string>`json_extract(j.value,'$.offerId')`.as(
                    "offer_id",
                  ),
                  quoteId: sql<string>`${row.id}`.as("quote_id"),
                  quantity: sql<number>`json_extract(j.value,'$.quantity')`.as(
                    "quantity",
                  ),
                  state: sql<"held">`'held'`.as("state"),
                  expiresAt: sql<Date>`${holdUntil.getTime()}`.as("expires_at"),
                  createdAt: nowMilliseconds.as("created_at"),
                  updatedAt: nowMilliseconds.as("updated_at"),
                })
                .from(sql`json_each(${JSON.stringify(goods)}) j`),
            ),
        ]
      : []),
    db
      .update(quote)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(quote.id, row.id)),
    db
      .insert(paymentAttempt)
      .values({
        id,
        sellerId: buyer.sellerId,
        quoteId: row.id,
        environment: context.environment,
        state: "planned",
        createRequestId,
        createRequestHash: hashPayload(request),
        captureRequestId: crypto.randomUUID(),
        amountMinor: row.totalMinor,
        currency: row.currency,
        payeeMerchantId: context.payeeMerchantId,
        nextCheckAt: new Date(Date.now() + 60_000),
      }),
    db
      .insert(auditEvent)
      .values({
        actor: "buyer",
        actorId: buyer.buyerSessionId,
        operation: "checkout.start",
        targetType: "payment_attempt",
        targetId: id,
        outcome: "ok",
        details: {
          quoteId: row.id,
          revision: row.revision,
          totalMinor: row.totalMinor,
        },
      }),
    clearBatchGuards(db, execution),
  ]);
  return id;
}

/** The whole D1 checkout command commits once, with native batch rollback on any failed effect. */
export function createD1CheckoutStorage(db: D1Db): CheckoutStorage {
  return {
    async holdAndRecord(buyer, input, context) {
      await assertLiveScope(db, buyer);
      const [row] = await db
        .select()
        .from(quote)
        .where(
          and(
            eq(quote.id, input.quoteId),
            eq(quote.sellerId, buyer.sellerId),
            eq(quote.buyerSessionId, buyer.buyerSessionId),
          ),
        );
      if (!row) throw notFound("quote");
      const existing = await existingIntent(db, buyer, row.id);
      if (existing) return existing;
      if (row.revision !== input.revision)
        throw conflict(
          "This quote changed. Review the latest version before paying.",
          ["open_latest"],
        );
      if (row.expiresAt <= new Date())
        throw new DomainError(
          "expired",
          "This quote expired. Ask for a fresh quote; prices are checked again.",
          ["requote"],
        );
      if (row.status !== "review_ready")
        throw conflict("This quote is not ready for payment yet.", ["revise"]);
      try {
        return await reserve(db, buyer, input, context, row);
      } catch (error) {
        if (!isBatchGuardFailure(error)) throw error;
        await assertLiveScope(db, buyer);
        // A competing checkout may have won. Revalidate this scope in a new batch
        // before joining its intent; no old receipt can execute stock effects.
        const winner = await existingIntent(db, buyer, row.id);
        if (winner) return winner;
        const goods = row.lines.filter((line) => line.kind === "goods");
        for (const line of goods) {
          const [stock] = await db
            .select()
            .from(inventory)
            .where(eq(inventory.offerId, line.offerId));
          if (!stock || stock.total - stock.held - stock.sold < line.quantity)
            throw new DomainError(
              "sold_out",
              `${line.title} just sold out. You have not been charged.`,
              ["requote"],
            );
        }
        throw conflict(
          "This quote or the shop changed before checkout. Ask for an updated quote.",
          ["requote"],
        );
      }
    },
  };
}
