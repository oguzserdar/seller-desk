/** A later catalog edit must not replace an earlier customer's paid download. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { armFault } from "@/fixtures/paypal-fixture";
import { getDb } from "@/server/db/client";
import { accessGrant, digitalQuoteLine, offer, orders } from "@/server/db/schema";
import { downloadWithGrant, grantToken, retryAccess, storeAsset } from "@/server/domain/digital";
import { saveOffer } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

async function replaceProduct() {
  const shop = await getSeller();
  const [current] = await getDb().select().from(offer).where(eq(offer.id, await offerId("Home brake care guide")));
  if (!shop || !current) throw new Error("Fixture shop missing");
  const replacement = await storeAsset(owner, { filename: "replacement.pdf", bytes: Buffer.from("%PDF-1.4 replacement") });
  await saveOffer(owner, shop, {
    id: current.id, expectedRevision: current.revision, kind: current.kind,
    title: current.title, description: current.description, unitAmountMinor: current.unitAmountMinor,
    fulfillmentNote: current.fulfillmentNote, requiresScopeReview: false, serviceScope: null,
    digitalAssetId: replacement.id, accessDays: 2, maxQuantity: 1, stockTotal: null,
  });
  return { originalAsset: current.digitalAssetId, originalDays: current.accessDays, replacement: replacement.id };
}

describe("purchased digital version", () => {
  it("fails closed if the original delivery terms are missing", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    await armFault(getDb(), "access_storage_error");
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    if (!paid.order) throw new Error("Fixture order missing");
    const [order] = await getDb().select().from(orders).where(eq(orders.id, paid.order.id));
    if (!order) throw new Error("Fixture order missing");
    await getDb().delete(digitalQuoteLine).where(eq(digitalQuoteLine.quoteId, order.quoteId));
    const before = await tally();
    expect(await retryAccess(buyer, order.id)).toMatchObject({ outcome: "not_eligible" });
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, order.id))).toHaveLength(0);
    expect(await tally()).toEqual(before);
  });

  it("does not undo revoked access when the seller replaces the product", async () => {
    const buyer = await newBuyer();
    const checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    if (!paid.order) throw new Error("Fixture order missing");
    await getDb().update(accessGrant).set({ state: "revoked" }).where(eq(accessGrant.orderId, paid.order.id));
    await replaceProduct();
    expect(await retryAccess(buyer, paid.order.id)).toMatchObject({ outcome: "not_eligible" });
    const grants = await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, paid.order.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.state).toBe("revoked");
  });

  for (const timing of ["after_delivery", "failed_delivery", "before_capture"] as const) {
    it(`keeps the purchased file and duration when the catalog changes ${timing}`, async () => {
      const buyer = await newBuyer();
      const checkout = await checkoutFor(buyer, "Home brake care guide");
      await approveAtPayPal(checkout);
      if (timing === "failed_delivery") await armFault(getDb(), "access_storage_error");
      let paid = timing !== "before_capture" ? await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true }) : null;
      const changed = await replaceProduct();
      paid ??= await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
      if (!paid.order) throw new Error("Fixture payment did not complete");
      const before = await tally();
      expect(await retryAccess(buyer, paid.order.id)).toMatchObject({ outcome: "granted" });
      const grants = await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, paid.order.id));
      expect(grants).toHaveLength(1);
      const grant = grants[0];
      const [order] = await getDb().select().from(orders).where(eq(orders.id, paid.order.id));
      if (!grant || !order || !changed.originalDays) throw new Error("Missing fixture result");
      expect(grant.assetId).toBe(changed.originalAsset);
      expect(grant.expiresAt.getTime()).toBe(order.paidAt.getTime() + changed.originalDays * 86_400_000);
      expect((await downloadWithGrant(grant.id, grantToken(grant.id))).mimeType).toBe("application/zip");
      expect(await tally()).toEqual(before);
      const next = await checkoutFor(await newBuyer(), "Home brake care guide");
      await approveAtPayPal(next);
      const newPaid = await reconcilePayment(owner, next.attemptId, { mayCapture: true });
      if (!newPaid.order) throw new Error("New purchase missing");
      const [newGrant] = await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, newPaid.order.id));
      expect(newGrant?.assetId).toBe(changed.replacement);
    });
  }
});
