// @vitest-environment happy-dom
/**
 * A service quote's panel leads with the step that is next: describing the work
 * before the shop prices it, paying once the shop has confirmed work and price.
 * A one-off repair has no quantity to choose.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";
import type { BuyerQuoteView } from "../../src/server/domain/quotes";

const line = { offerId: "repair", offerRevision: 1, kind: "service" as const, title: "Custom bike repair", unitAmountMinor: 11500, quantity: 1, lineTotalMinor: 11500, fulfillmentNote: "" };
const priced: BuyerQuoteView = {
  id: "quote-one", threadId: "thread-one", revision: 2, status: "review_ready", lines: [line], charges: [], unresolved: [],
  subtotalMinor: 11500, totalMinor: 11500, currency: "USD", expiresAt: "2099-01-01T00:00:00Z",
  policy: { policyRevision: 1, sellerName: "Test shop", pickupPolicy: null, serviceRequestPolicy: "We confirm a time after payment.", digitalAccessPolicy: null, cancellationPolicy: "Contact shop", taxPolicy: "Included" },
  approvedScope: "Replace the front brake cable and front pads.", reviewReason: null, buyerNote: "Front cable is frayed.", budgetMinor: 12500, deliveryRequested: false,
  isLatest: true, latestQuoteId: "quote-one", payment: null, order: null, next: ["accept_and_pay"],
};
const awaitingPrice: BuyerQuoteView = { ...priced, status: "seller_review", approvedScope: null, totalMinor: null, subtotalMinor: null, reviewReason: "The shop sets the price.",
  lines: [{ ...line, unitAmountMinor: null, lineTotalMinor: null }], next: [] };

let root: Root;
let container: HTMLDivElement;
function render(quote: BuyerQuoteView, limit = 1) {
  act(() => {
    root.render(createElement(QuoteSummary, { quote, imageFor: () => null, limitFor: () => limit, busy: null, error: null, payLabel: "Pay with PayPal", payReady: true,
      onQuantity: () => {}, onPay: () => {}, onReviewPayment: () => {}, onFix: () => {}, onStartOver: () => {} }));
  });
}
const button = (name: string) => [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === name) ?? null;
const visibleField = (label: string) => [...container.querySelectorAll("label")].find((element) => element.textContent?.includes(label) && element.closest("details:not([open])") === null) ?? null;

describe("service quote panel", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("before pricing, describing the work is the open step", () => {
    render(awaitingPrice);
    expect(visibleField("Describe the work")).not.toBeNull();
    expect(button("Pay with PayPal")).toBeNull();
    const item = container.querySelector('[aria-label="Items"]')!.textContent!;
    expect(item).toContain("Price set by the seller");
    expect(item).not.toContain("Awaiting quote");
  });

  it("once the shop priced the work, Pay comes first and changing the work is folded below it", () => {
    render(priced);
    const pay = button("Pay with PayPal");
    const change = [...container.querySelectorAll("summary")].find((element) => element.textContent?.trim() === "Change the work");
    expect(pay).not.toBeNull();
    expect(change).toBeDefined();
    expect(visibleField("Describe the work")).toBeNull();
    expect(pay!.compareDocumentPosition(change!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a fixed-price service that needs no review goes straight to Pay, like booking apps", () => {
    render({ ...priced, approvedScope: null, buyerNote: null });
    expect(button("Pay with PayPal")).not.toBeNull();
    expect(button("Send request to seller")?.closest("details:not([open])")).not.toBeNull();
    expect(visibleField("Describe the work")).toBeNull();
  });

  it("a one-off repair shows no quantity stepper; an item with stock to choose from still does", () => {
    render(priced, 1);
    expect(container.querySelector('[aria-label^="One more"]')).toBeNull();
    render({ ...priced, lines: [{ ...line, kind: "goods" }] }, 6);
    expect(container.querySelector('[aria-label^="One more"]')).not.toBeNull();
  });
});
