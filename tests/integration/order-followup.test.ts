/** Human-authored fixture inputs test the real database; no model answer is simulated. */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getDb, createDb } from "@/server/db/client";
import { accessGrant, auditEvent, fulfillmentTask, orderFollowup, orders, paymentAttempt, quote } from "@/server/db/schema";
import { listBuyerPurchases } from "@/server/domain/buyer-purchases";
import { queryDesk } from "@/server/domain/desk";
import { buyerOrderFollowup, replyOrderFollowup } from "@/server/domain/order-followup";
import { readOrderFollowup } from "@/server/domain/order-followup-read";
import { getBuyerOrder, orderAccessKey } from "@/server/domain/orders";
import { completeServiceWork } from "@/server/domain/service-work";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { reconcilePayment } from "@/server/payments/engine";
import { POST } from "@/app/api/buyer/orders/[id]/help/route";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });
async function purchase(title = "Brake check") {
  const buyer = await newBuyer();
  const checkout = await checkoutFor(buyer, title);
  await approveAtPayPal(checkout);
  const result = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!result.order) throw new Error("Missing paid fixture order");
  return { buyer, id: result.order.id, access: { buyer, key: null } };
}
async function commerce() {
  const db = getDb();
  return { orders: await db.select().from(orders), payments: await db.select().from(paymentAttempt), quotes: await db.select().from(quote), tasks: await db.select().from(fulfillmentTask), grants: await db.select().from(accessGrant) };
}

it("keeps a fulfilled order's problem visible, reads saved history on an independent connection, and only closes on explicit buyer confirmation", async () => {
  const { buyer, id, access } = await purchase();
  const [work] = await getDb().select().from(fulfillmentTask).where(eq(fulfillmentTask.type, "service_work"));
  await completeServiceWork(owner, { taskId: work!.id, expectedRevision: work!.revision, note: "Front brake cable replaced and tested." });
  const before = await commerce();
  const input = { orderId: id, expectedRevision: 0, action: "help" as const, message: "The front brake still squeaks." };
  const first = await buyerOrderFollowup(access, input);
  expect(first).toMatchObject({ state: "needs_help", revision: 1, nextActor: "seller" });
  expect(await buyerOrderFollowup(access, input)).toEqual(first);
  expect((await queryDesk(owner, { view: "needs_attention" })).rows.find(row => row.id === id)?.nextStep).toBe("Reply to the customer's problem");
  expect((await queryDesk(owner, { view: "completed" })).rows.map(row => row.id)).toContain(id);
  const reply = { orderId: id, expectedRevision: 1, message: "Please bring the bike back for us to inspect the squeak." };
  const answered = await replyOrderFollowup(owner, reply);
  expect(await replyOrderFollowup(owner, reply)).toEqual(answered);
  expect(answered).toMatchObject({ state: "awaiting_customer", nextActor: "buyer", revision: 2 });
  const independent = createDb(process.env.DATABASE_URL!, 1);
  try { expect(await readOrderFollowup(independent.db, id)).toEqual(answered); }
  finally { await independent.pool.end(); }
  expect((await getBuyerOrder(access, id)).followup).toEqual(answered);
  expect((await listBuyerPurchases(buyer)).orders[0]?.help.state).toBe("awaiting_customer");
  expect((await queryDesk(owner, { view: "all_orders" })).rows[0]?.nextStep).toBe("Waiting for customer confirmation");
  const confirm = { orderId: id, expectedRevision: 2, action: "confirm" as const };
  expect(await buyerOrderFollowup(access, confirm)).toMatchObject({ state: "confirmed", revision: 3, nextActor: null });
  await buyerOrderFollowup(access, confirm);
  expect(await commerce()).toEqual(before);
  expect(await getDb().select().from(orderFollowup)).toHaveLength(3);
  expect(await getDb().select().from(auditEvent).where(sql`${auditEvent.operation} like 'order_help.%'`)).toHaveLength(3);
  const reopened = await buyerOrderFollowup(access, { ...input, expectedRevision: 3, message: "It happened again on the way home." });
  expect(reopened).toMatchObject({ state: "needs_help", revision: 4, nextActor: "seller" });
  expect(reopened.history.map(row => row.message)).toContain(input.message);
});

it("does not mistake resolution of a question for completion of unfinished work, an appointment or a waiver", async () => {
  const { buyer, id, access } = await purchase();
  const before = await commerce();
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 0, action: "help", message: "Where should I leave the bike?" });
  await replyOrderFollowup(owner, { orderId: id, expectedRevision: 1, message: "At the front desk." });
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 2, action: "confirm" });
  const purchases = await listBuyerPurchases(buyer);
  expect(purchases.orders[0]?.stillToDo.join(" ")).toContain("work is still to be finished");
  expect(purchases.recordLimits.customerAcceptance).toBe("not_collected");
  expect((await queryDesk(owner, { view: "needs_attention" })).rows.map(row => row.id)).toContain(id);
  expect((await queryDesk(owner, { view: "completed" })).rows).toHaveLength(0);
  expect(await commerce()).toEqual(before);
});

it.each(["Disc brake pads", "Home brake care guide"]) ("keeps %s help independent from money, tasks and entitlements", async title => {
  const { id, access } = await purchase(title);
  const before = await commerce();
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 0, action: "help", message: "I need help with my purchase." });
  await replyOrderFollowup(owner, { orderId: id, expectedRevision: 1, message: "Please explain which part is not working." });
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 2, action: "help", message: "Thanks, I will wait for an actual resolution." });
  expect((await getBuyerOrder(access, id)).followup.state).toBe("needs_help");
  expect(await commerce()).toEqual(before);
});

it("refuses another buyer, forged owner/shop, wrong or expired links, AI-origin confirmation and malformed messages", async () => {
  const { buyer, id, access } = await purchase();
  const input = { orderId: id, expectedRevision: 0, action: "help" as const, message: "Please help with this order." };
  await expect(buyerOrderFollowup({ buyer: await newBuyer(), key: null }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(buyerOrderFollowup({ buyer: { ...buyer, sellerId: randomUUID() }, key: null }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(buyerOrderFollowup({ buyer: null, key: orderAccessKey(randomUUID()) }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(buyerOrderFollowup({ buyer: null, key: orderAccessKey(id, Date.now() - 31 * 86_400_000) }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(buyerOrderFollowup({ buyer: { ...buyer, assistantTurn: { id: randomUUID(), conversationId: randomUUID() } }, key: null }, input)).rejects.toMatchObject({ code: "invalid" });
  await expect(buyerOrderFollowup(access, { ...input, message: " " })).rejects.toThrow();
  await expect(buyerOrderFollowup(access, { ...input, message: "x".repeat(1001) })).rejects.toThrow();
  await expect(buyerOrderFollowup(access, { orderId: id, action: "confirm", expectedRevision: 0 })).rejects.toMatchObject({ code: "conflict" });
  await buyerOrderFollowup(access, input);
  const reply = { orderId: id, expectedRevision: 1, message: "I will look at your order." };
  await expect(replyOrderFollowup({ ...owner, userId: randomUUID() }, reply)).rejects.toMatchObject({ code: "not_found" });
  await expect(replyOrderFollowup({ ...owner, sellerId: randomUUID() }, reply)).rejects.toMatchObject({ code: "not_found" });
  expect(await getDb().select().from(orderFollowup)).toHaveLength(1);
});

it("serializes competing replies, refuses stale confirmation and retains all previous words", async () => {
  const { id, access } = await purchase();
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 0, action: "help", message: "A problem to investigate." });
  const replies = await Promise.allSettled(["First seller reply", "Second seller reply"].map(message => replyOrderFollowup(owner, { orderId: id, expectedRevision: 1, message })));
  expect(replies.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(replies.filter(result => result.status === "rejected")).toHaveLength(1);
  await buyerOrderFollowup(access, { orderId: id, expectedRevision: 2, action: "help", message: "I have one more detail to add." });
  await expect(buyerOrderFollowup(access, { orderId: id, expectedRevision: 2, action: "confirm" })).rejects.toMatchObject({ code: "conflict" });
  expect((await getBuyerOrder(access, id)).followup.history).toHaveLength(3);
});

it("rolls back the event if its audit cannot be saved; database constraints refuse owner confirmation", async () => {
  const { id, access } = await purchase();
  const db = getDb();
  await expect(db.insert(orderFollowup).values({ orderId: id, revision: 1, actor: "owner", state: "confirmed", message: "" })).rejects.toThrow();
  await db.execute(sql`create function reject_order_help_audit() returns trigger language plpgsql as $$ begin if NEW.operation like 'order_help.%' then raise exception 'test audit failure'; end if; return NEW; end $$`);
  await db.execute(sql`create trigger reject_order_help_audit before insert on audit_event for each row execute function reject_order_help_audit()`);
  try { await expect(buyerOrderFollowup(access, { orderId: id, expectedRevision: 0, action: "help", message: "Please inspect this." })).rejects.toThrow(); }
  finally { await db.execute(sql`drop trigger reject_order_help_audit on audit_event`); await db.execute(sql`drop function reject_order_help_audit()`); }
  expect(await db.select().from(orderFollowup)).toHaveLength(0);
});

it("serves signed-receipt requests, refuses mismatched targets and exposes no data without access", async () => {
  const { id } = await purchase();
  const send = async (body: unknown, key?: string) => POST(new Request(`http://localhost:4310/api/buyer/orders/${id}/help`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-order-key": key } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const body = { orderId: id, action: "help", expectedRevision: 0, message: "I need help from my receipt." };
  expect((await send(body)).status).toBe(404);
  expect((await send({ ...body, orderId: randomUUID() }, orderAccessKey(id))).status).toBe(400);
  const sent = await send(body, orderAccessKey(id));
  expect(sent.status).toBe(200);
  expect((await sent.json()).data).toMatchObject({ state: "needs_help", revision: 1 });
});
