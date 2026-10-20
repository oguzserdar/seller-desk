/**
 * After payment: digital access survives a storage failure and is retried
 * without a second charge; downloads need the grant's own token; owner task
 * actions refuse stale revisions; a service scope review creates a new quote
 * version the buyer must accept.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { armFault } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { accessGrant, fulfillmentTask, job, orders } from "@/server/db/schema";
import { downloadWithGrant, retryAccess } from "@/server/domain/digital";
import { queryDesk } from "@/server/domain/desk";
import type { DomainError } from "@/server/domain/errors";
import { completePickup, getBuyerOrder, recordServiceFollowUp } from "@/server/domain/orders";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { approveQuoteScope, declineQuote, getBuyerQuote } from "@/server/domain/quotes";
import { runDueWork } from "@/server/jobs/run";
import { reconcilePayment, startCheckout } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, quoteFor, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as DomainError).code ?? "error";
  }
}

async function buy(buyer: BuyerPrincipal, title: string): Promise<string> {
  const view = await checkoutFor(buyer, title);
  await approveAtPayPal(view);
  const paid = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
  if (paid.state !== "paid" || !paid.order) throw new Error(`not paid: ${paid.state}`);
  return paid.order.id;
}

async function task(orderId: string, type: "pickup" | "service_followup" | "digital_access") {
  const [row] = await getDb().select().from(fulfillmentTask).where(and(eq(fulfillmentTask.orderId, orderId), eq(fulfillmentTask.type, type)));
  if (!row) throw new Error(`no ${type} task`);
  return row;
}

describe("digital access", () => {
  beforeEach(async () => {
    ({ owner } = await resetShop());
  });

  it("paid order with a storage failure: access is retried later, never charged twice", async () => {
    const buyer = await newBuyer();
    await armFault(getDb(), "access_storage_error");
    const orderId = await buy(buyer, "Home brake care guide");
    expect((await task(orderId, "digital_access")).state).toBe("attention");
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).downloads).toHaveLength(0);

    await getDb().update(job).set({ runAfter: sql`now() - interval '1 second'` }).where(eq(job.targetId, orderId));
    const summary = await runDueWork("test");
    expect(summary.grantsTried).toBe(1);
    expect((await task(orderId, "digital_access")).state).toBe("completed");
    const view = await getBuyerOrder({ buyer, key: null }, orderId);
    expect(view.downloads).toHaveLength(1);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("owner retry is idempotent: one grant per asset", async () => {
    const buyer = await newBuyer();
    const orderId = await buy(buyer, "Home brake care guide");
    const again = await retryAccess(owner, orderId);
    expect(again).toMatchObject({ outcome: "granted", created: false });
    const grants = await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId));
    expect(grants).toHaveLength(1);
  });

  it("a download needs the grant's own token and an unexpired grant", async () => {
    const buyer = await newBuyer();
    const orderId = await buy(buyer, "Home brake care guide");
    const [download] = (await getBuyerOrder({ buyer, key: null }, orderId)).downloads;
    if (!download) throw new Error("no download");
    const file = await downloadWithGrant(download.grantId, download.token);
    expect(file.mimeType).toBe("application/zip");
    expect(Buffer.from(file.bytes).subarray(0, 2).toString()).toBe("PK");
    const [counted] = await getDb().select({ n: accessGrant.downloadCount }).from(accessGrant).where(eq(accessGrant.id, download.grantId));
    expect(counted?.n).toBe(1);
    expect(await code(downloadWithGrant(download.grantId, `${download.token.slice(0, -2)}xx`))).toBe("not_found");
    await getDb().update(accessGrant).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(accessGrant.id, download.grantId));
    expect(await code(downloadWithGrant(download.grantId, download.token))).not.toBe("resolved");
  });
});

describe("owner task actions", () => {
  beforeEach(async () => {
    ({ owner } = await resetShop());
  });

  it("pickup completes once; a stale second click is refused", async () => {
    const buyer = await newBuyer();
    const orderId = await buy(buyer, "Disc brake pads");
    const pickup = await task(orderId, "pickup");
    const done = await completePickup(owner, { taskId: pickup.id, expectedRevision: pickup.revision, note: "Collected" });
    expect(done.state).toBe("completed");
    expect(await code(completePickup(owner, { taskId: pickup.id, expectedRevision: pickup.revision, note: "Collected" }))).toBe("conflict");
  });

  it("service follow-up stays open until a time is confirmed", async () => {
    const buyer = await newBuyer();
    const orderId = await buy(buyer, "Brake check");
    const first = await task(orderId, "service_followup");
    const noted = await recordServiceFollowUp(owner, { taskId: first.id, expectedRevision: first.revision, note: "Left a voicemail", timeConfirmed: false });
    expect(noted.state).not.toBe("completed");
    const confirmed = await recordServiceFollowUp(owner, { taskId: first.id, expectedRevision: noted.revision, note: "Drop-off Saturday 10:00", timeConfirmed: true });
    expect(confirmed.state).toBe("completed");
    // Agreeing a time does not deliver the purchased service.
    expect((await queryDesk(owner, { view: "completed" })).rows.map(row => row.id)).not.toContain(orderId);
    expect((await queryDesk(owner, { view: "needs_attention" })).rows.map(row => row.id)).toContain(orderId);
    const [order] = await getDb().select({ id: orders.id }).from(orders);
    expect(order?.id).toBe(orderId);
  });
});

describe("service scope review", () => {
  beforeEach(async () => {
    ({ owner } = await resetShop());
  });

  it("the owner's approval is a new quote version; the old one cannot be paid", async () => {
    const buyer = await newBuyer();
    const asked = await quoteFor(buyer, "Brake service");
    expect(asked.status).toBe("seller_review");
    expect(await code(startCheckout(buyer, { quoteId: asked.id, revision: asked.revision }))).toBe("conflict");

    const approved = await approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: asked.revision, prices: [], approvedScope: "Front and rear brake pads replaced; cables adjusted." });
    expect(approved.revision).toBe(asked.revision + 1);
    expect(approved.status).toBe("review_ready");
    expect(await code(approveQuoteScope(owner, { quoteId: asked.id, expectedRevision: asked.revision, prices: [], approvedScope: "Again" }))).toBe("conflict");

    const latest = await getBuyerQuote(buyer, approved.id);
    expect(latest.approvedScope).toContain("brake pads");
    expect(await code(startCheckout(buyer, { quoteId: asked.id, revision: asked.revision }))).toBe("conflict");
    const view = await startCheckout(buyer, { quoteId: latest.id, revision: latest.revision });
    expect(view.state).toBe("order_created");
  });

  it("a declined quote cannot be paid and the buyer sees why", async () => {
    const buyer = await newBuyer();
    const asked = await quoteFor(buyer, "Brake service");
    await declineQuote(owner, { quoteId: asked.id, expectedRevision: asked.revision, reason: "We are fully booked this month." });
    const seen = await getBuyerQuote(buyer, asked.id);
    expect(seen.status).toBe("cancelled");
    expect(seen.reviewReason).toContain("fully booked");
    expect(await code(startCheckout(buyer, { quoteId: asked.id, revision: asked.revision }))).not.toBe("resolved");
  });
});
