import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ownerTools } from "@/server/ai/owner-tools";
import { getDb } from "@/server/db/client";
import { inventory, orders } from "@/server/db/schema";
import { readPaidSummary } from "@/server/domain/paid-summary";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
const options = { toolCallId: "test", messages: [], context: {} };
const now = new Date("2026-11-01T20:00:00Z");

async function paidAt(date: string, currency = "USD") {
  const buyer = await newBuyer();
  const checkout = await checkoutFor(buyer, "Disc brake pads");
  await approveAtPayPal(checkout);
  const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
  if (!paid.order) throw new Error("Expected paid fixture order");
  await getDb().update(orders).set({ paidAt: new Date(date), currency }).where(eq(orders.id, paid.order.id));
  return paid.order.id;
}

beforeEach(async () => { ({ owner } = await resetShop()); });

describe("owner chat reads", () => {
  it("selects server-owned cards only after reading them this turn", async () => {
    const id = await paidAt("2026-11-01T07:00:00Z");
    const tools = ownerTools(owner);
    expect(await tools.show_desk_rows.execute!({ ids: [id] }, options)).toHaveProperty("error");
    await tools.query_desk.execute!({ view: "all_orders", search: null }, options);
    expect(await tools.show_desk_rows.execute!({ ids: [id] }, options)).toMatchObject({ rows: [{ id, href: `/owner/orders/${id}` }] });
    expect(await tools.show_desk_rows.execute!({ ids: [crypto.randomUUID()] }, options)).toHaveProperty("error");
  });
  it("does not show another seller's order", async () => {
    const id = await paidAt("2026-11-01T07:00:00Z");
    const tools = ownerTools({ ...owner, sellerId: crypto.randomUUID() });
    const result = await tools.query_desk.execute!({ view: "all_orders", search: null }, options);
    expect(result).toMatchObject({ rows: [] });
    expect(await tools.show_desk_rows.execute!({ ids: [id] }, options)).toHaveProperty("error");
  });
  it("can search an order without presenting the whole desk", async () => {
    await paidAt("2026-11-01T07:00:00Z");
    await paidAt("2026-11-01T08:00:00Z");
    const result = await ownerTools(owner).query_desk.execute!({ view: "all_orders", search: "#1001" }, options);
    expect(result).toMatchObject({ rows: [{ ref: "#1001" }], coverage: { rowLimit: 25 } });
    expect(result).not.toHaveProperty("totals");
  });
});

describe("paid totals", () => {
  it("uses calendar boundaries through daylight saving, not the UTC date", async () => {
    await paidAt("2026-11-01T05:59:59Z"); // October 31 in Edmonton.
    await paidAt("2026-11-01T06:00:00Z"); // Midnight November 1.
    await paidAt("2026-11-02T06:59:59Z"); // End of the 25-hour day.
    await paidAt("2026-11-02T07:00:00Z"); // November 2.
    const report = await readPaidSummary(owner, { period: "yesterday", timeZone: "America/Edmonton" }, new Date("2026-11-02T20:00:00Z"));
    expect(report).toMatchObject({ startDate: "2026-11-01", endDateExclusive: "2026-11-02", totals: [{ currency: "USD", paidOrders: 2, paidMinor: 7000 }] });
  });
  it("separates currencies and excludes future, pending and other-shop records", async () => {
    await paidAt("2026-11-01T07:00:00Z", "CAD");
    await paidAt("2026-11-01T08:00:00Z");
    await paidAt("2026-11-02T08:00:00Z");
    await checkoutFor(await newBuyer(), "Disc brake pads");
    const result = await readPaidSummary(owner, { period: "today", timeZone: "America/Edmonton" }, now);
    expect(result.totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: "CAD", paidMinor: 3500, paidOrders: 1 }),
      expect.objectContaining({ currency: "USD", paidMinor: 3500, paidOrders: 1 }),
    ]));
    expect(result.totals).toHaveLength(2);
    const stranger = await readPaidSummary({ ...owner, sellerId: crypto.randomUUID() }, { period: "all_time", timeZone: "UTC" }, now);
    expect(stranger.totals).toEqual([]);
  });
  it("sums every matching payment, beyond the 25-card read limit", async () => {
    await getDb().update(inventory).set({ total: 1000 });
    for (let i = 0; i < 27; i++) await paidAt("2026-11-01T07:00:00Z");
    expect(await readPaidSummary(owner, { period: "all_time", timeZone: "UTC" }, now)).toMatchObject({ totals: [{ paidOrders: 27, paidMinor: 94500 }] });
  });
  it("rejects invalid time zones before querying", async () => {
    await expect(readPaidSummary(owner, { period: "today", timeZone: "Mars/Invalid" }, now)).rejects.toThrow();
  });
});
