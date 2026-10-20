/** Recovery claims must agree with the actual protected download gate. */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { accessGrant, job, orders } from "@/server/db/schema";
import { listBuyerPurchases } from "@/server/domain/buyer-purchases";
import { downloadWithGrant, grantToken, retryAccess } from "@/server/domain/digital";
import { getBuyerOrder } from "@/server/domain/orders";
import { proposeAction } from "@/server/domain/proposals";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";

beforeEach(async () => { await resetShop(); });
async function paidDownload() {
  const buyer = await newBuyer();
  const checkout = await checkoutFor(buyer, "Home brake care guide");
  await approveAtPayPal(checkout);
  const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!paid.order) throw new Error("No fixture purchase");
  const [grant] = await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, paid.order.id));
  if (!grant) throw new Error("No fixture download grant");
  return { buyer, orderId: paid.order.id, grant };
}

describe("truthful digital recovery", () => {
  for (const condition of ["expired", "revoked"] as const) it(`does not restore or advertise ${condition} access`, async () => {
    const { buyer, orderId, grant } = await paidDownload();
    await getDb().update(accessGrant).set(condition === "expired" ? { expiresAt: sql`now() - interval '1 second'` } : { state: "revoked" }).where(eq(accessGrant.id, grant.id));
    const before = (await getDb().select().from(accessGrant).where(eq(accessGrant.id, grant.id)))[0];
    const counts = await tally();
    const result = await retryAccess(buyer, orderId);
    expect(result).toMatchObject({ outcome: "not_eligible" });
    expect("reason" in result && result.reason).toMatch(/contact the seller/i);
    expect((await getDb().select().from(accessGrant).where(eq(accessGrant.id, grant.id)))[0]).toEqual(before);
    expect(await tally()).toEqual(counts);
    await expect(downloadWithGrant(grant.id, grantToken(grant.id))).rejects.toThrow();
    expect((await listBuyerPurchases(buyer)).orders[0]?.downloadsReady).toBe(0);
    const view = await getBuyerOrder({ buyer, key: null }, orderId);
    expect(view.downloads).toEqual([]);
    expect(view.tasks.find(t => t.type === "digital_access")).toMatchObject({ label: "Download access ended", tone: "attention" });
    const shop = await getSeller();
    if (!shop) throw new Error("No fixture seller");
    const ownerOutcome = await retryAccess({ kind: "owner", userId: shop.ownerUserId, sellerId: shop.id }, orderId);
    expect(ownerOutcome).toMatchObject({ outcome: "not_eligible" });
    expect("reason" in ownerOutcome && ownerOutcome.reason).not.toMatch(/contact the seller/i);
    const suggestion = await proposeAction({ kind: "owner", userId: shop.ownerUserId, sellerId: shop.id }, { action: "retry_access", targetId: orderId }).catch((error: Error) => error);
    expect(suggestion).toBeInstanceOf(Error);
    expect((suggestion as Error).message).not.toMatch(/already working/i);
    expect((await getDb().select().from(job).where(and(eq(job.targetId, orderId), eq(job.state, "pending"))))).toHaveLength(0);
  });

  it("does not create an already-expired grant when first delivery is delayed beyond access duration", async () => {
    const { buyer, orderId } = await paidDownload();
    await getDb().delete(accessGrant).where(eq(accessGrant.orderId, orderId));
    await getDb().update(orders).set({ paidAt: sql`now() - interval '90 days'` }).where(eq(orders.id, orderId));
    expect(await retryAccess(buyer, orderId)).toMatchObject({ outcome: "not_eligible" });
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(0);
  });

  it("requires both buyer identity and seller scope before retrying", async () => {
    const { buyer, orderId } = await paidDownload();
    await expect(retryAccess({ ...buyer, sellerId: crypto.randomUUID() }, orderId)).rejects.toThrow("not found");
  });
});
