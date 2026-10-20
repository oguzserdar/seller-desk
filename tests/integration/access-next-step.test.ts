/** Buyer and owner next steps must match actual download recovery eligibility. */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as retryRoute } from "@/app/api/buyer/orders/[id]/retry-access/route";
import { ownerTools } from "@/server/ai/owner-tools";
import { armFault } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { accessGrant, digitalQuoteLine, orders, ownerProposal } from "@/server/db/schema";
import { queryDesk } from "@/server/domain/desk";
import { retryAccess } from "@/server/domain/digital";
import { getBuyerOrder, getOwnerOrder } from "@/server/domain/orders";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { decideProposal, proposeAction } from "@/server/domain/proposals";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";
let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });
async function undelivered() {
  const buyer = await newBuyer(); const checkout = await checkoutFor(buyer, "Home brake care guide");
  await approveAtPayPal(checkout); await armFault(getDb(), "access_storage_error");
  const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!paid.order) throw new Error("No fixture order");
  return { buyer, orderId: paid.order.id };
}
async function expire(orderId: string) {
  await getDb().update(orders).set({ paidAt: sql`now() - interval '45 days'` }).where(eq(orders.id, orderId));
}
describe("actionable access next steps", () => {
  it("keeps the actual reason in a stale buyer retry response", async () => {
    const { buyer, orderId } = await undelivered();
    const original = await getBuyerOrder({ buyer, key: null }, orderId);
    await expire(orderId);
    const response = await retryRoute(new Request(`http://localhost:4310/api/buyer/orders/${orderId}/retry-access`, { method: "POST", headers: { "x-order-key": original.accessKey } }), { params: Promise.resolve({ id: orderId }) });
    const body = await response.json();
    expect(body.message).toMatch(/access period has ended/i);
    expect(body.message).not.toMatch(/no downloads/i);
    expect(body.data.canRetryAccess).toBe(false);
    expect(body.data.downloads).toEqual([]);
  });
  it("shows seller review before any retry when first delivery has expired", async () => {
    const { buyer, orderId } = await undelivered(); await expire(orderId); const before = await tally();
    const desk = await queryDesk(owner, { view: "needs_attention" });
    expect(desk.rows.find(row => row.id === orderId)).toMatchObject({ nextStep: "Review download access", tone: "attention" });
    const detail = await getOwnerOrder(owner, orderId);
    expect(detail.accessReview).toMatch(/access period has ended/i);
    const receipt = await getBuyerOrder({ buyer, key: null }, orderId);
    expect(receipt.canRetryAccess).toBe(false);
    expect(receipt.tasks.find(task => task.type === "digital_access")?.detail).toMatch(/contact the seller/i);
    expect(receipt.tasks.find(task => task.type === "digital_access")?.detail).not.toMatch(/retrying/i);
    expect(await tally()).toEqual(before);
  });
  it("lets the real assistant read the access failure reason", async () => {
    const { orderId } = await undelivered(); await expire(orderId);
    const tool = ownerTools(owner).query_desk;
    const result = await tool.execute!({ view: "all_orders", search: null }, { toolCallId: "access-read", messages: [], context: {} }) as { rows: { id: string; accessReview?: string }[] };
    expect(result.rows.find(row => row.id === orderId)?.accessReview).toMatch(/access period has ended/i);
  });
  it("does not save an impossible retry proposal", async () => {
    const { orderId } = await undelivered(); await expire(orderId);
    await expect(proposeAction(owner, { action: "retry_access", targetId: orderId })).rejects.toThrow(/access period has ended/i);
    expect(await getDb().select().from(ownerProposal)).toHaveLength(0);
  });
  it("keeps retry available for temporary storage failure", async () => {
    const { buyer, orderId } = await undelivered();
    expect((await queryDesk(owner, {})).rows.find(row => row.id === orderId)?.nextStep).toBe("Retry the download");
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).canRetryAccess).toBe(true);
    expect((await getOwnerOrder(owner, orderId)).accessReview).toBeNull();
    const proposal = await proposeAction(owner, { action: "retry_access", targetId: orderId });
    expect(await decideProposal(owner, { proposalId: proposal.proposalId, approve: true })).toMatchObject({ state: "executed" });
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).downloads).toHaveLength(1);
  });
  it("rechecks access that expires after a proposal", async () => {
    const { orderId } = await undelivered();
    const proposal = await proposeAction(owner, { action: "retry_access", targetId: orderId });
    await expire(orderId); const before = await tally();
    expect(await decideProposal(owner, { proposalId: proposal.proposalId, approve: true })).toMatchObject({ state: "failed", message: expect.stringMatching(/access period has ended/i) });
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(0);
    expect(await tally()).toEqual(before);
  });
  it("asks for review when original delivery details are missing", async () => {
    const { buyer, orderId } = await undelivered();
    const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId));
    await getDb().delete(digitalQuoteLine).where(eq(digitalQuoteLine.quoteId, order!.quoteId));
    expect((await getOwnerOrder(owner, orderId)).accessReview).toMatch(/original download details/i);
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).canRetryAccess).toBe(false);
    expect((await queryDesk(owner, {})).rows.find(row => row.id === orderId)?.nextStep).toBe("Review download access");
  });
  it("does not reopen historically completed delivery when access later expires", async () => {
    const { buyer, orderId } = await undelivered(); await retryAccess(owner, orderId);
    await getDb().update(accessGrant).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(accessGrant.orderId, orderId));
    expect((await queryDesk(owner, { view: "completed" })).rows.find(row => row.id === orderId)?.needsOwner).toBe(false);
    expect((await getBuyerOrder({ buyer, key: null }, orderId)).canRetryAccess).toBe(false);
    expect((await getOwnerOrder(owner, orderId)).accessReview).toMatch(/expired/i);
  });
  it("does not reveal another seller's access details", async () => {
    const { buyer, orderId } = await undelivered(); await expire(orderId);
    const stranger = { ...owner, sellerId: crypto.randomUUID() };
    await expect(getOwnerOrder(stranger, orderId)).rejects.toThrow(/not found/i);
    await expect(getBuyerOrder({ buyer: { ...buyer, sellerId: stranger.sellerId }, key: null }, orderId)).rejects.toThrow(/not found/i);
    expect((await queryDesk(stranger, {})).rows).toEqual([]);
  });
});
