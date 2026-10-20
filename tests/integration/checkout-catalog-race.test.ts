/** Checkout must keep the validated catalog and terms stable until its stock hold commits. */
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { getDb, transaction } from "@/server/db/client";
import { inventory, offer, seller } from "@/server/db/schema";
import { proposeQuote } from "@/server/domain/quotes";
import { startCheckout } from "@/server/payments/engine";
import { newBuyer, offerId, quoteFor, resetShop, tally } from "../support/shop";

beforeEach(async () => { await resetShop(); });

it.each(["policy", "price", "publication"])("a concurrent %s edit cannot commit between checkout validation and the stock hold", async (edit) => {
  const buyer = await newBuyer();
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  const id = await offerId("Disc brake pads");
  let pending: Promise<unknown> | undefined;
  try {
    await transaction(getDb(), async (tx) => {
      await tx.select().from(inventory).where(eq(inventory.offerId, id)).for("update");
      pending = startCheckout(buyer, { quoteId: reviewed.id, revision: reviewed.revision }).catch((error: unknown) => error);
      // The checkout is now past validation and waiting on the stock row held above.
      await vi.waitFor(async () => {
        const waiting = await getDb().execute(sql`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%update inventory set held = held +%'`);
        expect(waiting.rows.length).toBe(1);
      }, { timeout: 5000, interval: 20 });
      await expect(transaction(getDb(), async (writer) => {
        await writer.execute(sql`SET LOCAL lock_timeout = '100ms'`);
        if (edit === "policy") await writer.update(seller).set({ policyRevision: sql`${seller.policyRevision} + 1` }).where(eq(seller.id, buyer.sellerId));
        if (edit === "price") await writer.update(offer).set({ unitAmountMinor: 9999, revision: sql`${offer.revision} + 1` }).where(eq(offer.id, id));
        if (edit === "publication") await writer.update(offer).set({ published: false }).where(eq(offer.id, id));
      })).rejects.toMatchObject({ cause: { code: "55P03" } });
    });
  } finally {
    if (pending) await pending;
  }
  expect(await pending).toMatchObject({ state: "order_created", amount: "$35.00" });
  expect(await tally()).toMatchObject({ attempts: 1, providerOrders: 1, captures: 0 });
});

it("takes goods stock locks in a stable order even when the buyer lists the items backwards", async () => {
  const buyer = await newBuyer();
  const ids = [await offerId("Disc brake pads"), await offerId("Rechargeable front light")].sort();
  const [first, second] = ids as [string, string];
  const reviewed = await proposeQuote(buyer, { lines: [{ offerId: second, quantity: 1 }, { offerId: first, quantity: 1 }] });
  let pending: Promise<unknown> | undefined;
  try {
    await transaction(getDb(), async (tx) => {
      await tx.select().from(inventory).where(eq(inventory.offerId, first)).for("update");
      pending = startCheckout(buyer, { quoteId: reviewed.id, revision: reviewed.revision }).catch((error: unknown) => error);
      await vi.waitFor(async () => {
        const waiting = await getDb().execute(sql`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%update inventory set held = held +%'`);
        expect(waiting.rows.length).toBe(1);
      }, { timeout: 5000, interval: 20 });
      // A checkout waiting for the first stock row must not already own a later one.
      await transaction(getDb(), async (probe) => {
        await probe.execute(sql`SELECT offer_id FROM inventory WHERE offer_id=${second} FOR UPDATE NOWAIT`);
      });
    });
  } finally {
    if (pending) await pending;
  }
  expect(await pending).toMatchObject({ state: "order_created", amount: "$130.00" });
});
