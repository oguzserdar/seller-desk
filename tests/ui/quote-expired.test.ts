// @vitest-environment happy-dom
/** An expired quote offers one button to get a fresh one, and stops claiming a validity time. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";
import type { BuyerQuoteView } from "../../src/server/domain/quotes";

const expired: BuyerQuoteView = {
  id: "quote-one", threadId: "thread-one", revision: 1, status: "expired",
  lines: [{ offerId: "light", offerRevision: 1, kind: "goods", title: "Rechargeable front light", unitAmountMinor: 9500, quantity: 1, lineTotalMinor: 9500, fulfillmentNote: "" }],
  charges: [], unresolved: [], subtotalMinor: 9500, totalMinor: 9500, currency: "USD", expiresAt: "2020-01-01T00:00:00Z",
  policy: { policyRevision: 1, sellerName: "Test shop", pickupPolicy: "Pickup at the shop", serviceRequestPolicy: null, digitalAccessPolicy: null, cancellationPolicy: "Contact shop", taxPolicy: "Included" },
  approvedScope: null, reviewReason: null, buyerNote: null, budgetMinor: null, deliveryRequested: false,
  isLatest: true, latestQuoteId: "quote-one", payment: null, order: null, next: [],
};

let root: Root;
let container: HTMLDivElement;

describe("expired quote", () => {
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

  it("renews with the same lines in one click and drops the stale validity time", () => {
    const onRenew = vi.fn();
    act(() => {
      root.render(createElement(QuoteSummary, { quote: expired, imageFor: () => null, limitFor: () => 1, busy: null, error: null, payLabel: "Pay with PayPal", payReady: true,
        onQuantity: () => {}, onPay: () => {}, onReviewPayment: () => {}, onFix: () => {}, onStartOver: () => {}, onRenew }));
    });
    const renew = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Get a fresh quote");
    expect(renew).toBeTruthy();
    act(() => renew!.click());
    expect(onRenew).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Valid until");
  });
});
