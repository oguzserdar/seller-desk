import { nowMilliseconds, uuidDefault } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  fulfillmentTask,
  inventory,
  job,
  offer,
  orders,
  paymentAttempt,
  quote,
  reservation,
  storageSequence,
} from "@/server/db/sqlite/schema";
import type { OrderSnapshot } from "@/server/db/types";
import { assertQuotePriced } from "@/server/domain/priced-quote";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PaidCommitInput, PaidOutcome } from "../payments";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, isBatchGuardFailure } from "./guards";

async function existingOrder(
  db: D1Db,
  id: string,
): Promise<PaidOutcome | null> {
  const [row] = await db
    .select({ id: orders.id, number: orders.number })
    .from(orders)
    .where(eq(orders.paymentAttemptId, id));
  return row
    ? { orderId: row.id, orderNumber: row.number, created: false }
    : null;
}

/**
 * Commits verified payment, order, stock, fulfilment and audit in one D1 batch.
 * All pre-read reservation facts and allocation decisions are rechecked there.
 * A replay joins the order and cannot reapply stock effects or recreate jobs.
 */
export async function recordD1PaidOrder(
  db: D1Db,
  input: PaidCommitInput,
): Promise<PaidOutcome> {
  const [attempt] = await db
    .select()
    .from(paymentAttempt)
    .where(eq(paymentAttempt.id, input.attemptId));
  if (!attempt) throw new Error(`payment attempt ${input.attemptId} not found`);
  const existing = await existingOrder(db, attempt.id);
  if (existing) return existing;
  if (attempt.fence !== input.expectedFence)
    throw new Error(
      "The payment executor was replaced before committing its order.",
    );
  const [priced] = await db
    .select()
    .from(quote)
    .where(eq(quote.id, attempt.quoteId));
  if (!priced || !attempt.providerOrderId)
    throw new Error("paid attempt is missing its quote or provider order");
  assertQuotePriced(priced);
  if (
    priced.totalMinor !== attempt.amountMinor ||
    priced.currency !== attempt.currency
  )
    throw new Error("Paid quote differs from the accepted payment");
  const snapshot: OrderSnapshot = {
    quoteId: priced.id,
    quoteThreadId: priced.threadId,
    quoteRevision: priced.revision,
    lines: priced.lines,
    charges: priced.charges,
    subtotalMinor: priced.subtotalMinor,
    totalMinor: priced.totalMinor,
    currency: priced.currency,
    policy: priced.policySnapshot,
    approvedScope: priced.approvedScope,
    buyerNote: priced.buyerNote,
  };
  const goods = priced.lines
    .filter((line) => line.kind === "goods")
    .sort((a, b) => a.offerId.localeCompare(b.offerId));
  const state = goods.length
    ? await db
        .select({ offerId: offer.id, stock: inventory, hold: reservation })
        .from(offer)
        .leftJoin(inventory, eq(inventory.offerId, offer.id))
        .leftJoin(
          reservation,
          and(
            eq(reservation.offerId, offer.id),
            eq(reservation.quoteId, priced.id),
          ),
        )
        .where(
          inArray(
            offer.id,
            goods.map((line) => line.offerId),
          ),
        )
    : [];
  const decisions = goods.map((line) => {
    const row = state.find((row) => row.offerId === line.offerId),
      hold = row?.hold,
      stock = row?.stock;
    if (hold?.state === "held" && (!stock || stock.held < line.quantity))
      throw new Error("Reserved stock could not be verified.");
    const take = Boolean(
      stock && stock.total - stock.held - stock.sold >= line.quantity,
    );
    const secured =
      hold?.state === "captured" || hold?.state === "held" || take;
    return { line, hold, secured, take };
  });
  const facts = decisions.map(({ line, hold, take }) => ({
    offerId: line.offerId,
    quantity: line.quantity,
    id: hold?.id ?? null,
    state: hold?.state ?? null,
    reservedQuantity: hold?.quantity ?? null,
    take: Number(take),
  }));
  const stockProblems = decisions
    .filter((item) => !item.secured)
    .map(
      (item) => `${item.line.title}: stock ran out before payment completed`,
    );
  const id = crypto.randomUUID(),
    execution = crypto.randomUUID(),
    kinds = new Set(priced.lines.map((line) => line.kind));
  const effects = decisions
    .filter(({ hold }) => hold?.state !== "captured")
    .map(({ line, hold, secured }) => ({
      offerId: line.offerId,
      quantity: line.quantity,
      held: hold?.state === "held" ? line.quantity : 0,
      sold: secured ? line.quantity : 0,
      state: secured ? "captured" : "attention",
    }));
  const packet = JSON.stringify(effects),
    source = sql`json_each(${packet}) j`;
  const stockWrites = effects.length
    ? [
        db
          .update(inventory)
          .set({
            held: sql`${inventory.held}-(select cast(json_extract(j.value,'$.held') as integer) from json_each(${packet}) j where json_extract(j.value,'$.offerId')=inventory.offer_id)`,
            sold: sql`${inventory.sold}+(select cast(json_extract(j.value,'$.sold') as integer) from json_each(${packet}) j where json_extract(j.value,'$.offerId')=inventory.offer_id)`,
          })
          .where(
            sql`${inventory.offerId} in (select json_extract(j.value,'$.offerId') from json_each(${packet}) j)`,
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
                quoteId: sql<string>`${priced.id}`.as("quote_id"),
                quantity: sql<number>`json_extract(j.value,'$.quantity')`.as(
                  "quantity",
                ),
                state: sql<
                  "captured" | "attention"
                >`json_extract(j.value,'$.state')`.as("state"),
                expiresAt: nowMilliseconds.as("expires_at"),
                createdAt: nowMilliseconds.as("created_at"),
                updatedAt: nowMilliseconds.as("updated_at"),
              })
              .from(source)
              .where(sql`true`),
          )
          .onConflictDoUpdate({
            target: [reservation.quoteId, reservation.offerId],
            set: { state: sql`excluded.state`, updatedAt: new Date() },
          }),
      ]
    : [];
  const valid = sql`exists(select 1 from payment_attempt where id=${attempt.id} and fence=${input.expectedFence} and quote_id=${priced.id} and provider_order_id=${attempt.providerOrderId} and amount_minor=${priced.totalMinor} and currency=${priced.currency})
    and not exists(select 1 from orders where payment_attempt_id=${attempt.id})
    and exists(select 1 from quote where id=${priced.id} and lines=${JSON.stringify(priced.lines)} and total_minor=${priced.totalMinor} and currency=${priced.currency})
    and not exists(select 1 from json_each(${JSON.stringify(facts)}) f left join reservation r on r.offer_id=json_extract(f.value,'$.offerId') and r.quote_id=${priced.id} left join inventory i on i.offer_id=json_extract(f.value,'$.offerId')
      where r.id is not json_extract(f.value,'$.id') or r.state is not json_extract(f.value,'$.state') or r.quantity is not json_extract(f.value,'$.reservedQuantity')
      or (r.state='held' and (i.offer_id is null or i.held<json_extract(f.value,'$.quantity')))
      or (coalesce(r.state,'missing') not in ('held','captured') and coalesce((i.total-i.held-i.sold>=json_extract(f.value,'$.quantity')),0)<>json_extract(f.value,'$.take')))`;
  try {
    const results = await db.batch([
      batchGuard(db, `${execution}:paid`, valid),
      db
        .insert(storageSequence)
        .values({ name: "orders", value: 1001 })
        .onConflictDoUpdate({
          target: storageSequence.name,
          set: { value: sql`${storageSequence.value}+1` },
        }),
      db
        .insert(orders)
        .values({
          id,
          number: sql`(select value from storage_sequence where name='orders')`,
          sellerId: attempt.sellerId,
          paymentAttemptId: attempt.id,
          quoteId: priced.id,
          buyerSessionId: priced.buyerSessionId,
          environment: attempt.environment,
          providerOrderId: attempt.providerOrderId,
          providerCaptureId: input.captureId,
          snapshot,
          totalMinor: priced.totalMinor,
          currency: priced.currency,
          buyerName: input.payer.name?.slice(0, 120) ?? null,
          buyerEmail: input.payer.email?.slice(0, 200) ?? null,
          paidAt: new Date(input.evidence.observedAt),
        }),
      ...stockWrites,
      ...(kinds.has("goods")
        ? [
            db
              .insert(fulfillmentTask)
              .values({
                orderId: id,
                type: "pickup",
                state: stockProblems.length ? "attention" : "pending",
                lastError: stockProblems.length
                  ? stockProblems.join("; ")
                  : null,
              }),
          ]
        : []),
      ...(kinds.has("service")
        ? [
            db.insert(fulfillmentTask).values([
              { orderId: id, type: "service_followup", state: "pending" },
              { orderId: id, type: "service_work", state: "pending" },
            ]),
          ]
        : []),
      ...(kinds.has("digital")
        ? [
            db
              .insert(fulfillmentTask)
              .values({
                orderId: id,
                type: "digital_access",
                state: "pending",
              }),
            db
              .insert(job)
              .values({ kind: "grant_access", targetId: id, state: "pending" }),
          ]
        : []),
      db
        .update(quote)
        .set({ status: "consumed" })
        .where(eq(quote.id, priced.id)),
      db
        .update(paymentAttempt)
        .set({
          state: "paid",
          providerCaptureId: input.captureId,
          evidence: input.evidence,
          paidAt: new Date(input.evidence.observedAt),
          lastProviderStatus: input.evidence.captureStatus,
          lastError: null,
          uncertainSince: null,
          nextCheckAt: null,
        })
        .where(eq(paymentAttempt.id, attempt.id)),
      db
        .insert(auditEvent)
        .values({
          actor: "system",
          operation: "payment.paid",
          targetType: "order",
          targetId: id,
          outcome: "ok",
          details: {
            attemptId: attempt.id,
            environment: attempt.environment,
            totalMinor: priced.totalMinor,
            stockProblems: stockProblems.length,
          },
        }),
      db
        .select({ number: orders.number })
        .from(orders)
        .where(eq(orders.id, id)),
      clearBatchGuards(db, execution),
    ]);
    const row = (results[results.length - 2] as { number: number }[])[0];
    if (!row) throw new Error("order insert returned nothing");
    return { orderId: id, orderNumber: row.number, created: true };
  } catch (error) {
    if (!isBatchGuardFailure(error)) throw error;
    const winner = await existingOrder(db, attempt.id);
    if (winner) return winner;
    const [current] = await db
      .select({ fence: paymentAttempt.fence })
      .from(paymentAttempt)
      .where(eq(paymentAttempt.id, attempt.id));
    if (current?.fence !== input.expectedFence)
      throw new Error(
        "The payment executor was replaced before committing its order.",
      );
    throw new Error(
      "Stock changed before payment recording. The verified capture will be reconciled again.",
    );
  }
}
