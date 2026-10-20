// @vitest-environment happy-dom
/** Buyer checkout recovery must preserve server-confirmed payment and lead with the existing order. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuyerQuote } from "../../src/components/buyer/use-buyer-quote";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";
import type { BuyerQuoteView } from "../../src/server/domain/quotes";

const { api, push } = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const initial: BuyerQuoteView = {
  id: "quote-one", threadId: "thread-one", revision: 1, status: "review_ready", lines: [], charges: [], unresolved: [],
  subtotalMinor: 2500, totalMinor: 2500, currency: "USD", expiresAt: "2099-01-01T00:00:00Z",
  policy: { policyRevision: 1, sellerName: "Test shop", pickupPolicy: "Pickup", serviceRequestPolicy: "Confirm first", digitalAccessPolicy: "Download", cancellationPolicy: "Contact shop", taxPolicy: "Included" },
  approvedScope: null, reviewReason: null, buyerNote: null, budgetMinor: null, deliveryRequested: false,
  isLatest: true, latestQuoteId: "quote-one", payment: null, order: null, next: ["accept_and_pay"],
};
const paid: BuyerQuoteView = { ...initial, status: "consumed", payment: { attemptId: "payment-one", state: "paid", approvalUrl: null }, order: { id: "order-one", number: 1018, tasks: [] }, next: ["check_payment"] };
const ok = (data: unknown) => ({ data, httpStatus: 200, message: "OK", next: [], requestId: "test", state: "ok" });
let hook: ReturnType<typeof useBuyerQuote>;
let root: Root;
let container: HTMLDivElement;
let serverQuote: BuyerQuoteView;
let handoffNumber: number;

function Harness() {
  hook = useBuyerQuote({ widget: true, onSessionLost: async () => {} });
  return createElement("p", null, hook.quote?.status ?? "none");
}
async function focus() {
  await act(async () => { window.dispatchEvent(new Event("focus")); });
}

describe("returning from checkout to the original widget", () => {
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(window, "open").mockReturnValue(null);
    serverQuote = initial;
    handoffNumber = 0;
    api.mockImplementation(async (path: string) => path === "/api/buyer/handoff"
      ? ok({ code: `handoff-${++handoffNumber}` }) : ok(serverQuote));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(Harness)); });
    await act(async () => { hook.restoreQuote(initial); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    api.mockReset();
  });

  it("replaces the pay action with the verified order after returning to the tab", async () => {
    await act(async () => { await hook.pay(); });
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining("#handoff="), "_blank", "noopener");
    serverQuote = paid;
    await focus();
    expect(hook.quote).toMatchObject({ status: "consumed", order: { number: 1018 } });
  });

  it("refreshes after visibility returns, and makes no quote requests while hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    api.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(api.mock.calls.filter(([path]) => path.startsWith("/api/buyer/quote"))).toHaveLength(0);
    serverQuote = paid;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(hook.quote?.order?.number).toBe(1018);
  });

  it("polls visible pending checkout and stops periodic quote reads once paid", async () => {
    serverQuote = paid;
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(hook.quote?.status).toBe("consumed");
    api.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.mock.calls.filter(([path]) => path.startsWith("/api/buyer/quote"))).toHaveLength(0);
  });

  it("does not overlap refreshes or overwrite a newer quote with a delayed old response", async () => {
    let resolve!: (result: ReturnType<typeof ok>) => void;
    api.mockImplementation((path: string) => path === "/api/buyer/handoff" ? Promise.resolve(ok({ code: "fresh" })) : new Promise((done) => { resolve = done; }));
    await focus();
    await focus();
    expect(api.mock.calls.filter(([path]) => path.startsWith("/api/buyer/quote"))).toHaveLength(1);
    const newer = { ...initial, id: "quote-two", latestQuoteId: "quote-two", revision: 2, totalMinor: 5000 };
    await act(async () => { hook.restoreQuote(newer); });
    await act(async () => { resolve(ok(paid)); });
    expect(hook.quote).toMatchObject({ id: "quote-two", totalMinor: 5000, payment: null });
  });

  it("cannot revive the old buyer quote after the chat has been reset", async () => {
    let resolve!: (result: ReturnType<typeof ok>) => void;
    api.mockImplementation((path: string) => path === "/api/buyer/handoff" ? Promise.resolve(ok({ code: "fresh" })) : new Promise((done) => { resolve = done; }));
    await focus();
    await act(async () => { hook.reset(); resolve(ok(paid)); });
    expect(hook.quote).toBeNull();
  });

  it("prepares a different single-use link after opening checkout", async () => {
    await act(async () => { await hook.pay(); });
    const firstHref = vi.mocked(window.open).mock.calls[0]?.[0];
    await act(async () => { await hook.pay(); });
    const secondHref = vi.mocked(window.open).mock.calls[1]?.[0];
    expect(secondHref).toBeTruthy();
    expect(secondHref).not.toBe(firstHref);
  });

  it("does not call a purchase paid just because the buyer returns", async () => {
    await act(async () => { await hook.pay(); });
    await focus();
    expect(hook.quote).toMatchObject({ status: "review_ready", payment: null, order: null });
    expect(api.mock.calls.some(([path]) => path === "/api/buyer/checkout")).toBe(false);
  });

  it("opens payment and order review outside the frame using the one-time handoff", async () => {
    await act(async () => { hook.restoreQuote(paid); });
    await act(async () => { hook.openReview(); });
    expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^\/quote\/quote-one#handoff=/), "_blank", "noopener");
    expect(push).not.toHaveBeenCalled();
  });

  it("does not hide a quote when checkout wins the cancellation race", async () => {
    serverQuote = paid;
    api.mockImplementation(async (path: string) => path.endsWith("/cancel")
      ? { ...ok(null), httpStatus: 409, message: "This quote is already being paid." }
      : path === "/api/buyer/handoff" ? ok({ code: "fresh" }) : ok(serverQuote));
    await act(async () => { hook.startOver(); });
    expect(hook.quote?.order?.number).toBe(1018);
    expect(hook.error).toContain("already being paid");
  });

  it("releases a finished manual request when an AI quote overtakes its response", async () => {
    let resolve!: (result: ReturnType<typeof ok>) => void;
    const newer = { ...initial, id: "quote-two", latestQuoteId: "quote-two", totalMinor: 5000 };
    api.mockImplementation((path: string) => path === "/api/buyer/quote"
      ? new Promise((done) => { resolve = done; })
      : Promise.resolve(path === "/api/buyer/handoff" ? ok({ code: "fresh" }) : ok(newer)));
    await act(async () => { hook.setQuantity("offer", 2); });
    expect(hook.busy).toBe("quote");
    await act(async () => { await hook.loadQuote("quote-two"); });
    await act(async () => { resolve(ok(initial)); });
    expect(hook.quote?.id).toBe("quote-two");
    expect(hook.busy).toBeNull();
  });

  it("shows a server-confirmed order instead of Payment started or another pay button", async () => {
    const reviewOrder = vi.fn();
    await act(async () => { root.render(createElement(QuoteSummary, {
      quote: { ...paid, approvedScope: "Repair the front cable only. Timing is not confirmed." }, imageFor: () => null, limitFor: () => 1, busy: null, error: null,
      payLabel: "Review and pay in a new tab", payReady: true, onQuantity: () => {}, onPay: () => {}, onReviewPayment: reviewOrder, onFix: () => {}, onStartOver: () => {},
    })); });
    // The server-confirmed order shows one "Paid" status mark beside the order number.
    expect(container.querySelector("[role=status]")?.textContent).toBe("Paid");
    expect(container.textContent).toContain("Order #1018");
    expect(container.textContent).not.toContain("Payment started");
    expect(container.textContent).not.toContain("Review and pay");
    expect(container.querySelector("h2")?.textContent).toBe("Order #1018");
    const text = container.textContent ?? "";
    expect(text.indexOf("View your order")).toBeLessThan(text.indexOf("Repair the front cable only"));
    const orderButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "View your order");
    await act(async () => { orderButton?.click(); });
    expect(reviewOrder).toHaveBeenCalledTimes(1);
  });

  it("does not present an unresolved capture as a paid purchase", async () => {
    await act(async () => { root.render(createElement(QuoteSummary, {
      quote: { ...initial, payment: { attemptId: "pending", state: "capture_unknown", approvalUrl: null } },
      imageFor: () => null, limitFor: () => 1, busy: null, error: null, payLabel: "Pay with PayPal", payReady: true,
      onQuantity: () => {}, onPay: () => {}, onReviewPayment: () => {}, onFix: () => {}, onStartOver: () => {},
    })); });
    expect(container.querySelector("h2")?.textContent).toBe("Your quote");
    expect(container.textContent).toContain("Check payment status");
    expect(container.textContent).not.toContain("Payment confirmed");
    expect(container.textContent).not.toContain("View your order");
    expect(container.textContent).not.toContain("Pay with PayPal");
  });

  it("shows an unknown service price without a zero total or payment button", async () => {
    const waiting: BuyerQuoteView = { ...initial, status: "seller_review", subtotalMinor: null, totalMinor: null,
      lines: [{ offerId: "repair", offerRevision: 1, kind: "service", title: "Chair repair", quantity: 1, unitAmountMinor: null, lineTotalMinor: null, fulfillmentNote: "Confirm work first" }],
      buyerNote: "Repair two chair legs", next: ["wait_for_seller", "cancel"] };
    await act(async () => { root.render(createElement(QuoteSummary, {
      quote: waiting, imageFor: () => null, limitFor: () => 5, busy: null, error: null,
      payLabel: "Pay with PayPal", payReady: true, onQuantity: () => {}, onPay: () => {}, onReviewPayment: () => {}, onFix: () => {}, onStartOver: () => {},
    })); });
    expect(container.textContent).toContain("Awaiting quote");
    expect(container.textContent).not.toContain("$0.00");
    expect(container.textContent).not.toContain("Pay with PayPal");
    expect(container.querySelector("textarea")?.value).toBe("Repair two chair legs");
  });

  it("preserves buyer work details when changing quantity", async () => {
    await act(async () => { hook.restoreQuote({ ...initial, buyerNote: "Keep the original finish" }); });
    await act(async () => { hook.setQuantity("repair", 2); });
    expect(api).toHaveBeenCalledWith("/api/buyer/quote", expect.objectContaining({ json: expect.objectContaining({ buyerNote: "Keep the original finish" }) }));
  });
});
