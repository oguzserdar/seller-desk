/**
 * @fileoverview Unit tests for the Seller Desk analyst's shop facts.
 * @module tests/unit/seller-desk-agent
 *
 * shopFacts feeds the analyst's four read-only tools: shop pulse, customers waiting,
 * restock watch and top sellers, all computed from the rows the page loaded.
 */
import { describe, expect, it } from "vitest";
import { shopFacts } from "@/components/insights/seller-desk-agent";
import type { InsightsData } from "@/server/domain/insights";

const order = (product: string, amount: number, needsYou = "Done") =>
  ({ product, amount, needsYou }) as unknown as InsightsData["orders"][number];
const data = {
  asOf: "2026-11-10T12:00:00.000Z",
  currency: "USD",
  orders: [order("Brake service", 120, "Needs you"), order("Brake service", 120), order("Guide", 25), order("Light", 95)],
  conversations: [
    { id: "a", customer: "Customer 3", date: "2026-11-09T10:00:00.000Z", handledBy: "Assistant", waitingForYou: "Waiting for you", topic: "Do you ship to Canada?" },
    { id: "b", customer: "Customer 2", date: "2026-11-08T10:00:00.000Z", handledBy: "Assistant", waitingForYou: "Answered", topic: "Hours?" },
    { id: "c", customer: "Customer 1", date: "2026-11-07T10:00:00.000Z", handledBy: "You", waitingForYou: "Answered", topic: "Refund?" },
  ],
  offers: [
    { id: "1", title: "Light", kind: "Pickup item", price: 95, inStock: 3, sold: 1 },
    { id: "2", title: "Saddle", kind: "Pickup item", price: 65, inStock: 1, sold: 0 },
    { id: "3", title: "Brake service", kind: "Service", price: 120, inStock: null, sold: 2 },
  ],
} as InsightsData;

describe("shopFacts", () => {
  it("sums the pulse from paid orders and counts only conversations that needed nobody", () => {
    expect(shopFacts(data).pulse).toEqual({
      revenue: "$360.00",
      paidOrders: 4,
      averageOrder: "$90.00",
      ordersOwingWork: 1,
      conversations: 3,
      answeredByAssistantAlone: "33%",
      customersWaiting: 1,
    });
  });

  it("lists waiting customers by label with what they asked", () => {
    expect(shopFacts(data).waiting).toEqual([{ customer: "Customer 3", asked: "Do you ship to Canada?", since: "2026-11-09" }]);
  });

  it("flags only stocked goods at or below the threshold, lowest first, never services", () => {
    expect(shopFacts(data).restock(2)).toEqual([{ offer: "Saddle", left: 1, sold: 0 }]);
    expect(shopFacts(data).restock(3).map((row) => row.offer)).toEqual(["Saddle", "Light"]);
  });

  it("ranks products by paid revenue", () => {
    expect(shopFacts(data).topSellers[0]).toEqual({ product: "Brake service", revenue: "$240.00", units: 2 });
  });
});
