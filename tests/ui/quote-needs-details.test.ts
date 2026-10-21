// @vitest-environment happy-dom
/** Custom work without a description is the buyer's next step: the panel says so and offers the way to do it. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";
import type { BuyerQuoteView } from "../../src/server/domain/quotes";

const undescribed: BuyerQuoteView = {
  id: "quote-one", threadId: "thread-one", revision: 1, status: "needs_information",
  lines: [{ offerId: "custom", offerRevision: 1, kind: "service", title: "Custom repair or service", unitAmountMinor: null, quantity: 1, lineTotalMinor: null, fulfillmentNote: "" }],
  charges: [], unresolved: [{ code: "details_needed", message: "Describe the work so the seller can give you an accurate quote." }],
  subtotalMinor: null, totalMinor: null, currency: "USD", expiresAt: "2099-01-01T00:00:00Z",
  policy: { policyRevision: 1, sellerName: "Test shop", pickupPolicy: null, serviceRequestPolicy: "Seller confirms timing after payment.", digitalAccessPolicy: null, cancellationPolicy: "Contact shop", taxPolicy: "Included" },
  approvedScope: null, reviewReason: null, buyerNote: null, budgetMinor: null, deliveryRequested: false,
  isLatest: true, latestQuoteId: "quote-one", payment: null, order: null, next: [],
} as BuyerQuoteView;

it("names the missing description as the total and offers a way to give it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onDescribe = vi.fn();
  try {
    await act(async () => root.render(createElement(QuoteSummary, { quote: undescribed, imageFor: () => null, limitFor: () => 1, busy: null, error: null, payLabel: "Pay with PayPal", payReady: true,
      onQuantity: () => {}, onPay: () => {}, onReviewPayment: () => {}, onFix: () => {}, onStartOver: () => {}, describeInChat: true, onDescribe })));
    expect(container.textContent).toContain("Needs details");
    expect(container.textContent).not.toContain("Awaiting quote");
    expect(container.textContent).not.toContain("Needs a change");
    const describe = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Describe the work");
    expect(describe).toBeDefined();
    await act(async () => describe!.click());
    expect(onDescribe).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
