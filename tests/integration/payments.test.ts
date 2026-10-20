/**
 * Payment failure suite: duplicate clicks, concurrent captures, lost responses,
 * pending and declined captures, forged evidence, forged returns, stale
 * approvals, webhook replay, cancellation races and restart recovery.
 * One purchase must yield at most one PayPal capture and one order.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { armFault, decideFixtureOrder, FIXTURE_SIGNATURE_HEADER, settleFixtureCapture, signFixtureWebhook } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { paymentAttempt } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { runDueWork } from "@/server/jobs/run";
import { cancelCheckout, reconcilePayment, startCheckout } from "@/server/payments/engine";
import { ingestWebhook } from "@/server/payments/webhooks";
import { getPayPal } from "@/server/paypal";
import { TEST_ENV } from "../support/test-env";
import { runInNewProcess } from "../support/process";
import {
  approveAtPayPal,
  attemptRow,
  checkoutFor,
  expireHolds,
  makeDue,
  newBuyer,
  providerOrderOf,
  quoteFor,
  resetShop,
  stockOf,
  tally,
} from "../support/shop";

const MUG = "Disc brake pads";

async function signedWebhook(event: object) {
  const raw = JSON.stringify(event);
  const headers = new Headers({ [FIXTURE_SIGNATURE_HEADER]: signFixtureWebhook(raw, TEST_ENV.JOBS_SECRET as string) });
  return ingestWebhook(headers, raw);
}

/** The capture request reached PayPal and succeeded, but our side never recorded the response. */
async function captureReachedPayPalButResponseLost(attemptId: string): Promise<void> {
  const row = await attemptRow(attemptId);
  const paypal = getPayPal();
  if (!paypal.ok || !row.providerOrderId) throw new Error("no PayPal order to capture");
  await paypal.transport.captureOrder(row.providerOrderId, row.captureRequestId);
  await getDb().update(paymentAttempt).set({ state: "capture_in_flight", uncertainSince: new Date(), lastError: "capture_timeout" }).where(eq(paymentAttempt.id, attemptId));
}

describe("payments", () => {
  beforeEach(async () => {
    await resetShop();
  });

  it("repeated Pay clicks join one attempt and one PayPal order", async () => {
    const buyer = await newBuyer();
    const quote = await quoteFor(buyer, MUG);
    const views = await Promise.all([1, 2, 3].map(() => startCheckout(buyer, { quoteId: quote.id, revision: quote.revision })));
    expect(new Set(views.map((v) => v.attemptId)).size).toBe(1);
    expect(await tally()).toMatchObject({ attempts: 1, providerOrders: 1 });
    expect((await stockOf(MUG)).held).toBe(1);
  });

  it("concurrent captures after approval: one capture, one order, stock sold once", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    const results = await Promise.all([1, 2, 3].map(() => reconcilePayment(buyer, view.attemptId, { mayCapture: true })));
    expect(results.some((r) => r.state === "paid")).toBe(true);
    const final = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(final.state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
    expect(await stockOf(MUG)).toEqual({ total: 6, held: 0, sold: 1 });
  });

  it("returning from PayPal without approving captures nothing", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(after.state).toBe("order_created");
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
  });

  it("another buyer cannot read or capture this checkout", async () => {
    const owner = await newBuyer();
    const stranger = await newBuyer();
    const view = await checkoutFor(owner, MUG);
    await approveAtPayPal(view);
    await expect(reconcilePayment(stranger, view.attemptId, { mayCapture: true })).rejects.toMatchObject({ code: "not_found" });
    expect(await tally()).toMatchObject({ captures: 0 });
  });

  it("create response lost after PayPal acted: the retry reuses the request id, one PayPal order", async () => {
    const buyer = await newBuyer();
    await armFault(getDb(), "create_lost_after_effect");
    const view = await checkoutFor(buyer, MUG);
    expect(view.state).toBe("create_in_flight");
    expect((await attemptRow(view.attemptId)).uncertainSince).not.toBeNull();
    expect((await tally()).providerOrders).toBe(1);
    const retried = await reconcilePayment(buyer, view.attemptId, { mayCapture: false });
    expect(retried.state).toBe("order_created");
    expect((await tally()).providerOrders).toBe(1);
  });

  it("create response lost before PayPal acted: the retry creates exactly one order", async () => {
    const buyer = await newBuyer();
    await armFault(getDb(), "create_lost_before_effect");
    const view = await checkoutFor(buyer, MUG);
    expect(view.state).toBe("create_in_flight");
    expect((await tally()).providerOrders).toBe(0);
    await makeDue(view.attemptId);
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("order_created");
    expect((await tally()).providerOrders).toBe(1);
  });

  it("capture response lost after PayPal captured: the independent read records one payment", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "capture_lost_after_effect");
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(after.state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("restart while a capture is unconfirmed: a fresh process takes over the expired lease and records one payment", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await captureReachedPayPalButResponseLost(view.attemptId);
    expect((await tally()).captures).toBe(1);
    expect((await tally()).orders).toBe(0);

    // The executor "dies" holding a live lease: nobody else may act on the attempt yet.
    await getDb().update(paymentAttempt).set({ leaseOwner: "crashed-process", leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(paymentAttempt.id, view.attemptId));
    await makeDue(view.attemptId);
    await getDb().update(paymentAttempt).set({ leaseOwner: "crashed-process", leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(paymentAttempt.id, view.attemptId));
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("capture_in_flight");

    // The lease expires; a newly started process finishes the job.
    await getDb().update(paymentAttempt).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(paymentAttempt.id, view.attemptId));
    const summary = await runInNewProcess<{ paymentsChecked: number }>("tests/support/jobs-child.ts");
    expect(summary.paymentsChecked).toBe(1);
    expect((await attemptRow(view.attemptId)).state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  }, 60_000);

  it("pending capture stays pending until PayPal completes it, then one order", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "capture_pending");
    const pending = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(pending.state).toBe("verification_pending");
    expect((await tally()).orders).toBe(0);
    await settleFixtureCapture(getDb(), providerOrderOf(view), "COMPLETED");
    await makeDue(view.attemptId);
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("pending capture that PayPal declines: no order and the stock returns to sale", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "capture_pending");
    await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    await settleFixtureCapture(getDb(), providerOrderOf(view), "DECLINED");
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(after.state).toBe("failed");
    expect((await tally()).orders).toBe(0);
    expect(await stockOf(MUG)).toEqual({ total: 6, held: 0, sold: 0 });
  });

  it("instrument declined: the buyer can approve another way and pay once", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "capture_declined");
    const declined = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(declined.state).toBe("order_created");
    expect(declined.headline).toMatch(/declined/i);
    const paid = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(paid.state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("PayPal reports another payee before capture: nothing is captured and the owner reviews it", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "evidence_wrong_payee");
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(after.state).toBe("verification_pending");
    expect(after.tone).toBe("attention");
    expect((await attemptRow(view.attemptId)).lastError).toBe("evidence_mismatch:precapture:payee");
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
    expect((await stockOf(MUG)).held).toBe(1);
  });

  it("captured amount differs from the quote: not accepted as paid, held for the owner", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "evidence_wrong_amount", 2);
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(after.state).toBe("verification_pending");
    expect((await attemptRow(view.attemptId)).lastError).toBe("evidence_mismatch:amount");
    expect((await tally()).orders).toBe(0);
    expect((await stockOf(MUG)).held).toBe(1);
  });

  it("approval after the hold was released is never captured", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await expireHolds(view.quoteId);
    await makeDue(view.attemptId);
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("cancelled");
    expect((await stockOf(MUG)).held).toBe(0);
    await decideFixtureOrder(getDb(), providerOrderOf(view), "approve");
    const late = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
    expect(late.state).toBe("cancelled");
    expect((await tally()).captures).toBe(0);
  });

  it("approval while an expired hold is still in place is honoured once", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await expireHolds(view.quoteId);
    await makeDue(view.attemptId);
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("buyer cancels: the hold is released and nothing is charged", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    const cancelled = await cancelCheckout(buyer, view.attemptId);
    expect(cancelled.state).toBe("cancelled");
    expect(await stockOf(MUG)).toEqual({ total: 6, held: 0, sold: 0 });
  });

  it("buyer cancels after PayPal already captured: the payment is recorded, not cancelled", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await captureReachedPayPalButResponseLost(view.attemptId);
    const after = await cancelCheckout(buyer, view.attemptId);
    expect(after.state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("webhook: forged is refused, signed finishes the payment, replay changes nothing", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    const event = { id: "WH-TEST-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: providerOrderOf(view), status: "APPROVED" } };
    const forged = await ingestWebhook(new Headers({ [FIXTURE_SIGNATURE_HEADER]: "0".repeat(64) }), JSON.stringify(event));
    expect(forged.status).toBe(401);
    expect((await attemptRow(view.attemptId)).state).toBe("order_created");
    const delivered = await signedWebhook(event);
    expect(delivered).toMatchObject({ status: 200, message: "Received" });
    expect((await attemptRow(view.attemptId)).state).toBe("paid");
    const replay = await signedWebhook(event);
    expect(replay).toMatchObject({ status: 200, duplicate: true });
    const lateApproval = await signedWebhook({ ...event, id: "WH-TEST-2" });
    expect(lateApproval.status).toBe(200);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("webhook while PayPal reads fail: the payment is finished by the next recovery pass", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    await approveAtPayPal(view);
    await armFault(getDb(), "read_unavailable");
    await signedWebhook({ id: "WH-TEST-3", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: providerOrderOf(view), status: "APPROVED" } });
    expect((await attemptRow(view.attemptId)).state).not.toBe("paid");
    await makeDue(view.attemptId);
    await runDueWork("test");
    expect((await attemptRow(view.attemptId)).state).toBe("paid");
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("a request id is never reused for a different payload", async () => {
    const buyer = await newBuyer();
    const view = await checkoutFor(buyer, MUG);
    const row = await attemptRow(view.attemptId);
    await getDb().update(paymentAttempt).set({ state: "create_in_flight", amountMinor: row.amountMinor + 100 }).where(eq(paymentAttempt.id, row.id));
    const after = await reconcilePayment(buyer, view.attemptId, { mayCapture: false });
    expect(after.state).toBe("failed");
    expect((await tally()).providerOrders).toBe(1);
  });

  it("DomainError carries a code the routes can map", () => {
    expect(new DomainError("sold_out", "x").code).toBe("sold_out");
  });
});
