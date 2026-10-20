/** @fileoverview Operating counts over real fixture records, with no mocked or scripted model replies. */
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureConversation } from "@/server/ai/conversation";
import { ownerTools } from "@/server/ai/owner-tools";
import { getDb } from "@/server/db/client";
import { auditEvent, fulfillmentTask, offer, orders, shopGuide } from "@/server/db/schema";
import { buyerOrderFollowup, replyOrderFollowup } from "@/server/domain/order-followup";
import { completeServiceWork } from "@/server/domain/service-work";
import { answerQuestion, askSeller } from "@/server/domain/seller-questions";
import { saveGuide } from "@/server/domain/shop-guide";
import { readWorkSummary } from "@/server/domain/work-summary";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });
async function purchase(title: string) {
  const buyer = await newBuyer();
  const checkout = await checkoutFor(buyer, title);
  await approveAtPayPal(checkout);
  const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!paid.order) throw new Error("Fixture purchase failed");
  return { buyer, orderId: paid.order.id, access: { buyer, key: null } };
}

it("reports empty counts without inventing zero-valued performance measurements", async () => {
  const result = await readWorkSummary(owner);
  expect(Object.values(result.counts).every(n => n === 0)).toBe(true);
  expect(result.notMeasured).toContain("AI-attributed resolutions");
  expect(result.notMeasured).toContain("recovered-payment count");
  expect(result.environment).toBe("fixture");
  expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
});

it("refuses mismatched caller identity and shop even through the tool", async () => {
  for (const stranger of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
    await expect(readWorkSummary(stranger)).rejects.toMatchObject({ code: "not_found" });
    await expect(ownerTools(stranger).work_summary.execute!({}, { toolCallId: "denied-read", messages: [], context: {} })).rejects.toMatchObject({ code: "not_found" });
  }
});

it("separates payment, unfinished work, completed delivery and latest buyer confirmation", async () => {
  const service = await purchase("Brake check");
  const digital = await purchase("Home brake care guide");
  await checkoutFor(await newBuyer(), "Disc brake pads");
  expect((await readWorkSummary(owner)).counts).toMatchObject({ paidOrders: 2, ordersRecordedFulfilled: 1, ordersWithUnfinishedTasks: 1, paymentsAwaitingConfirmation: 1, problemsConfirmedByCustomer: 0 });
  await buyerOrderFollowup(service.access, { orderId: service.orderId, action: "help", expectedRevision: 0, message: "Where do I leave the bike?" });
  await replyOrderFollowup(owner, { orderId: service.orderId, expectedRevision: 1, message: "Please leave it at the front desk." });
  expect((await readWorkSummary(owner)).counts).toMatchObject({ problemsWaitingForCustomer: 1, problemsConfirmedByCustomer: 0 });
  await buyerOrderFollowup(service.access, { orderId: service.orderId, action: "confirm", expectedRevision: 2 });
  expect((await readWorkSummary(owner)).counts).toMatchObject({ problemsConfirmedByCustomer: 1, ordersWithUnfinishedTasks: 1 });
  await buyerOrderFollowup(service.access, { orderId: service.orderId, action: "help", expectedRevision: 3, message: "The front desk is closed now." });
  const [task] = await getDb().select().from(fulfillmentTask).where(eq(fulfillmentTask.type, "service_work"));
  await completeServiceWork(owner, { taskId: task!.id, expectedRevision: task!.revision, note: "Inspection completed and findings recorded." });
  expect((await readWorkSummary(owner)).counts).toMatchObject({ paidOrders: 2, ordersRecordedFulfilled: 2, ordersWithUnfinishedTasks: 0, problemsNeedingSeller: 1, problemsWaitingForCustomer: 0, problemsConfirmedByCustomer: 0 });
  await buyerOrderFollowup(digital.access, { orderId: digital.orderId, action: "help", expectedRevision: 0, message: "How can I use the files?" });
  expect((await readWorkSummary(owner)).counts.problemsNeedingSeller).toBe(2);
});

it("counts saved answers separately from resolution beyond the assistant's 25-row display", async () => {
  for (let i = 0; i < 27; i++) {
    const buyer = await newBuyer(); await ensureConversation(buyer);
    const { question } = await askSeller(buyer, { question: "Which door is for pickup?", customerGoal: "Find pickup entrance", knownFacts: [] });
    if (i !== 26) await answerQuestion(owner, { questionId: question.id, expectedRevision: question.revision, answer: "Use the side entrance during normal hours." });
  }
  const result = await ownerTools(owner).work_summary.execute!({}, { toolCallId: "actual-summary", messages: [], context: {} });
  expect(result).toMatchObject({ counts: { sellerQuestionsOpen: 1, sellerAnswersSaved: 26, problemsConfirmedByCustomer: 0 } });
});

it("counts available knowledge, excluding expired, hidden and unpublished-product entries", async () => {
  const make = (title: string, published = true, productId: string | null = null) => saveGuide(owner, {
    title, body: "Use the side entrance during normal pickup hours.", topic: "general", published,
    productId, validUntil: null, actionLabel: "", actionUrl: "",
  });
  await make("Available fact");
  await make("Private draft", false);
  const expired = await make("Expired fact");
  await getDb().update(shopGuide).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(shopGuide.id, expired.id));
  const archived = await make("Archived fact");
  await getDb().update(shopGuide).set({ archived: true, published: false }).where(eq(shopGuide.id, archived.id));
  const id = await offerId("Disc brake pads");
  await make("Hidden product fact", true, id);
  await getDb().update(offer).set({ published: false }).where(eq(offer.id, id));
  expect((await readWorkSummary(owner)).counts.publicFactsAvailable).toBe(1);
});

it("does not count future orders or missing task records as fulfilled and never writes on read", async () => {
  const missing = await purchase("Disc brake pads");
  const future = await purchase("Home brake care guide");
  await getDb().delete(fulfillmentTask).where(eq(fulfillmentTask.orderId, missing.orderId));
  await getDb().update(orders).set({ paidAt: new Date(Date.now() + 86_400_000) }).where(eq(orders.id, future.orderId));
  const before = await getDb().select().from(auditEvent);
  const snapshot = await getDb().execute(sql`select row_to_json(o) from orders o order by id`);
  expect((await readWorkSummary(owner)).counts).toMatchObject({ paidOrders: 1, ordersRecordedFulfilled: 0, ordersMissingTasks: 1 });
  expect(await getDb().select().from(auditEvent)).toEqual(before);
  expect((await getDb().execute(sql`select row_to_json(o) from orders o order by id`)).rows).toEqual(snapshot.rows);
});
