/** Paid service work survives scheduling; explicit delivery changes no payment records. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { auditEvent, fulfillmentTask, orders, paymentAttempt } from "@/server/db/schema";
import { listBuyerPurchases } from "@/server/domain/buyer-purchases";
import { queryDesk } from "@/server/domain/desk";
import { getBuyerOrder, recordServiceFollowUp } from "@/server/domain/orders";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { completeServiceWork } from "@/server/domain/service-work";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

async function purchase() {
  const buyer = await newBuyer();
  const checkout = await checkoutFor(buyer, "Brake check");
  await approveAtPayPal(checkout);
  const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!paid.order) throw new Error("No paid order");
  const tasks = await getDb().select().from(fulfillmentTask).where(eq(fulfillmentTask.orderId, paid.order.id));
  const work = tasks.find(task => task.type === "service_work")!;
  const followUp = tasks.find(task => task.type === "service_followup")!;
  return { buyer, id: paid.order.id, work, followUp };
}

it("keeps purchased work open after a confirmed time, then records delivery without changing paid evidence", async () => {
  const { buyer, id, work, followUp } = await purchase();
  const before = { orders: await getDb().select().from(orders), payments: await getDb().select().from(paymentAttempt) };
  const agreed = await recordServiceFollowUp(owner, { taskId: followUp.id, expectedRevision: followUp.revision, note: "Buyer agreed Saturday 10am", timeConfirmed: true });
  const waiting = await listBuyerPurchases(buyer);
  expect(waiting.orders[0]?.stillToDo.join(" ")).toContain("work is still to be finished");
  expect((await queryDesk(owner, { view: "service_followup" })).rows.map(row => row.id)).toContain(id);
  const input = { taskId: work.id, expectedRevision: work.revision, note: "Replaced front cable; tested brakes. Rear work was not purchased." };
  const results = await Promise.allSettled([completeServiceWork(owner, input), completeServiceWork(owner, input)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect((await queryDesk(owner, { view: "needs_attention" })).rows.map(row => row.id)).not.toContain(id);
  expect((await queryDesk(owner, { view: "completed" })).rows.map(row => row.id)).toContain(id);
  expect((await queryDesk(owner, { view: "completed" })).rows.find(row => row.id === id)?.nextStep).toBe("Fulfilled; no customer feedback");
  const seen = await getBuyerOrder({ buyer, key: null }, id);
  expect(seen.tasks.find(task => task.type === "service_work")).toMatchObject({ state: "completed", label: "The shop marked your work finished", detail: `Shop's completion note: ${input.note}` });
  expect((await listBuyerPurchases(buyer)).orders[0]?.fulfillment).toContainEqual({ label: "The shop marked your work finished", detail: `Shop's completion note: ${input.note}` });
  const modelRecords = await listBuyerPurchases(buyer);
  expect(modelRecords.recordLimits).toEqual({ customerAcceptance: "not_collected", appointmentDateTime: "not_shared" });
  expect(JSON.stringify(modelRecords)).not.toContain("Buyer agreed Saturday 10am");
  expect((await getDb().select().from(fulfillmentTask).where(eq(fulfillmentTask.id, followUp.id)))[0]).toEqual(agreed);
  expect({ orders: await getDb().select().from(orders), payments: await getDb().select().from(paymentAttempt) }).toEqual(before);
  expect(await getDb().select().from(auditEvent).where(and(eq(auditEvent.operation, "fulfillment.service_work_complete"), eq(auditEvent.targetId, work.id)))).toHaveLength(1);
});

it("finishes asynchronous work without inventing an appointment or losing private follow-up history", async () => {
  const { buyer, id, work, followUp } = await purchase();
  await recordServiceFollowUp(owner, { taskId: followUp.id, expectedRevision: followUp.revision, note: "Internal follow-up note", timeConfirmed: false });
  await completeServiceWork(owner, { taskId: work.id, expectedRevision: work.revision, note: "Delivered the purchased repair." });
  const seen = await getBuyerOrder({ buyer, key: null }, id);
  expect(seen.tasks.find(task => task.type === "service_followup")).toMatchObject({ state: "completed", label: "Time follow-up closed" });
  expect(JSON.stringify(seen.tasks)).not.toContain("Service time confirmed");
  expect(JSON.stringify(seen.tasks)).not.toContain("Internal follow-up note");
  const [closed] = await getDb().select().from(fulfillmentTask).where(eq(fulfillmentTask.id, followUp.id));
  expect(closed?.details).toMatchObject({ closedBecauseWorkCompleted: true, followUps: [{ note: "Internal follow-up note" }] });
  await expect(recordServiceFollowUp(owner, { taskId: followUp.id, expectedRevision: followUp.revision, note: "Old tab says booked", timeConfirmed: true })).rejects.toMatchObject({ code: "conflict" });
});

it("refuses forged owner identity, foreign shop, wrong task, stale revision and an empty completion note", async () => {
  const { buyer, id, work, followUp } = await purchase();
  const input = { taskId: work.id, expectedRevision: work.revision, note: "Completed the purchased service." };
  await expect(completeServiceWork({ ...owner, userId: randomUUID() }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(completeServiceWork({ ...owner, sellerId: randomUUID() }, input)).rejects.toMatchObject({ code: "not_found" });
  await expect(completeServiceWork(owner, { ...input, taskId: followUp.id })).rejects.toMatchObject({ code: "not_found" });
  await expect(completeServiceWork(owner, { ...input, expectedRevision: 99 })).rejects.toMatchObject({ code: "conflict" });
  await expect(completeServiceWork(owner, { ...input, note: " " })).rejects.toThrow();
  expect((await getBuyerOrder({ buyer, key: null }, id)).tasks.every(task => task.state === "pending")).toBe(true);
  expect(await getDb().select().from(auditEvent).where(eq(auditEvent.operation, "fulfillment.service_work_complete"))).toHaveLength(0);
});
