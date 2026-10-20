/**
 * The buyer agent's after-payment tools, called as the model would call them:
 * they read only this buyer's records, finish an approved payment exactly once
 * when the return page never loaded, and restore a download without charging.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { armFault } from "@/fixtures/paypal-fixture";
import { buyerTools } from "@/server/ai/buyer-tools";
import { getDb } from "@/server/db/client";
import { accessGrant, orders, paymentAttempt } from "@/server/db/schema";
import type { BuyerPurchases } from "@/server/domain/buyer-purchases";
import type { BuyerPrincipal } from "@/server/domain/principal";
import { getSeller, type SellerRow } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";

const toolOptions = { toolCallId: "test-call", messages: [], context: {} };
let shop: SellerRow;

async function buy(buyer: BuyerPrincipal, title: string): Promise<string> {
  const view = await checkoutFor(buyer, title);
  await approveAtPayPal(view);
  const paid = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
  if (paid.state !== "paid" || !paid.order) throw new Error(`not paid: ${paid.state}`);
  return paid.order.id;
}

beforeEach(async () => {
  await resetShop();
  const found = await getSeller();
  if (!found) throw new Error("no shop");
  shop = found;
});

describe("after-payment tools", () => {
  it("uses the paid order's own payment handle to confirm the saved capture without another charge", async () => {
    const buyer = await newBuyer();
    const tools = buyerTools(buyer, shop);
    const orderId = await buy(buyer, "Disc brake pads");
    const before = { orders: await getDb().select().from(orders), attempts: await getDb().select().from(paymentAttempt) };
    const purchases = await tools.my_orders.execute!({}, toolOptions) as BuyerPurchases;
    const found = purchases.orders.find(order => order.orderId === orderId)!;
    expect(found.paymentId).toBe(before.orders[0]?.paymentAttemptId);
    expect(purchases.otherPayments).toHaveLength(0);
    const checked = await tools.check_payment.execute!({ paymentId: found.paymentId }, toolOptions);
    expect(checked).toMatchObject({ verified: true, checkType: "stored_record", order: { id: orderId } });
    expect({ orders: await getDb().select().from(orders), attempts: await getDb().select().from(paymentAttempt) }).toEqual(before);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("'I paid but the page froze': check_payment finishes the approved payment once, never twice", async () => {
    const buyer = await newBuyer();
    const tools = buyerTools(buyer, shop);
    const view = await checkoutFor(buyer, "Disc brake pads");
    await approveAtPayPal(view); // approved in PayPal; our return page never loaded
    const before = (await tools.my_orders.execute!({}, toolOptions)) as BuyerPurchases;
    expect(before.orders).toHaveLength(0);
    expect(before.otherPayments.map((payment) => payment.paymentId)).toContain(view.attemptId);

    const first = (await tools.check_payment.execute!({ paymentId: view.attemptId }, toolOptions)) as { verified?: boolean; order?: { number: number } | null };
    const again = (await tools.check_payment.execute!({ paymentId: view.attemptId }, toolOptions)) as { verified?: boolean };
    expect(first.verified).toBe(true);
    expect(first.order?.number).toBeGreaterThan(0);
    expect(again.verified).toBe(true);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
    expect(((await tools.my_orders.execute!({}, toolOptions)) as BuyerPurchases).orders).toHaveLength(1);
  });

  it("another buyer's tools can neither see nor touch this payment", async () => {
    const payer = await newBuyer();
    const stranger = buyerTools(await newBuyer(), shop);
    const view = await checkoutFor(payer, "Disc brake pads");
    await approveAtPayPal(view);
    const attempt = (await stranger.check_payment.execute!({ paymentId: view.attemptId }, toolOptions)) as { error?: string; verified?: boolean };
    expect(attempt.error).toBeTruthy();
    expect(attempt.verified).toBeUndefined();
    expect(await tally()).toMatchObject({ orders: 0, captures: 0 });
    const seen = (await stranger.my_orders.execute!({}, toolOptions)) as BuyerPurchases;
    expect(seen.orders).toHaveLength(0);
    expect(seen.otherPayments).toHaveLength(0);
  });

  it("restore_download grants access once after a storage failure, with no second charge", async () => {
    await armFault(getDb(), "access_storage_error");
    const buyer = await newBuyer();
    const orderId = await buy(buyer, "Home brake care guide");
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(0);
    const tools = buyerTools(buyer, shop);
    expect(await tools.restore_download.execute!({ orderId }, toolOptions)).toMatchObject({ outcome: "granted" });
    await tools.restore_download.execute!({ orderId }, toolOptions);
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(1);
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });
});
