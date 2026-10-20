/**
 * @fileoverview Regressions for current payment facts in the buyer agent's input.
 * @module tests/integration/buyer-purchase-context
 * Exercises real quote/payment operations and scope boundaries in PostgreSQL.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buyerState, buyerTools } from "@/server/ai/buyer-tools";
import { listBuyerPurchases } from "@/server/domain/buyer-purchases";
import { getBuyerQuote } from "@/server/domain/quotes";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, resetShop, tally } from "../support/shop";

beforeEach(async () => { await resetShop(); });

describe("current buyer purchase context", () => {
  it("keeps a completed purchase visible after its quote stops being editable", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    expect(paid.order).not.toBeNull();
    const before = await tally();
    const state = await buyerState(buyer);
    expect(state).toContain(paid.order!.id);
    expect(state).toContain("Home brake care guide");
    expect(state).toContain("paidAt");
    expect(state).not.toContain("no quote yet");
    expect(await tally()).toEqual(before);
  });

  it("includes unconfirmed payment identity instead of implying checkout never started", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Disc brake pads");
    const state = await buyerState(buyer);
    expect(state).toContain(checkout.attemptId);
    expect(state).toContain('"status":"Approve the payment in PayPal"');
    expect(state).toContain('"amount":"$35.00"');
    expect(state).not.toContain('"state":"order_created"');
    expect(await listBuyerPurchases(buyer)).toMatchObject({
      orders: [],
      otherPayments: [{ paymentId: checkout.attemptId, state: "order_created" }],
    });
    expect(await tally()).toMatchObject({ orders: 0, captures: 0, attempts: 1 });
  });

  it("does not leak another buyer's or seller's purchase history", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Disc brake pads");
    await approveAtPayPal(checkout);
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    const otherBuyerState = await buyerState(await newBuyer());
    const otherShopState = await buyerState({ ...buyer, sellerId: crypto.randomUUID() });
    for (const state of [otherBuyerState, otherShopState]) {
      expect(state).not.toContain(paid.order!.id);
      expect(state).not.toContain(checkout.attemptId);
      expect(state).not.toContain("Disc brake pads");
    }
  });

  it("prepares a separate new quote while retaining the verified purchase in context", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    const shop = (await getSeller())!;
    const result = await buyerTools(buyer, shop).propose_quote.execute!({ mode: "add", lines: [{ offerId: await offerId("Disc brake pads"), quantity: 1 }], budgetMinor: null, deliveryRequested: false, buyerNote: null }, { toolCallId: "next-purchase", messages: [], context: {} });
    expect(result).toMatchObject({ status: "review_ready", totalMinor: 3500 });
    expect((await getBuyerQuote(buyer, checkout.quoteId)).status).toBe("consumed");
    const state = await buyerState(buyer);
    expect(state).toContain("Disc brake pads");
    expect(state).toContain(paid.order!.id);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1, attempts: 1 });
  });
});
