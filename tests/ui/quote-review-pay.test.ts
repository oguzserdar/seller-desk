// @vitest-environment happy-dom
/**
 * @fileoverview Customer quote review: a stale quote is reloaded after a refused checkout, and a paid
 * payment always links to its order from the server's own payment view.
 * @module tests/ui/quote-review-pay
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api, takeFragmentParam: () => null, saveToken: vi.fn(), readToken: () => ({ token: "t" }) }));
import { QuoteReview } from "../../src/app/quote/[id]/quote-review";
import { PaymentStatus } from "../../src/components/buyer/payment-status";

afterEach(() => { api.mockReset(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const ok = (data: unknown) => ({ data, httpStatus: 200, message: "OK" });

async function mount(element: ReturnType<typeof createElement>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => { createRoot(container).render(element); });
  return container;
}

it("reloads the quote when checkout refuses it as changed or expired", async () => {
  const quote = { id: "q1", revision: 3, status: "review_ready", isLatest: true, latestQuoteId: "q1", lines: [], charges: [], unresolved: [], order: null, payment: null, currency: "USD", totalMinor: 9500, approvedScope: null, reviewReason: null, policy: { sellerName: "Shop", cancellationPolicy: null, digitalAccessPolicy: null, pickupPolicy: null, serviceRequestPolicy: null, taxPolicy: null } };
  api.mockImplementation(async (path: string) => {
    if (path === "/api/buyer/checkout") return { data: null, httpStatus: 409, message: "This quote changed. Check it and pay again." };
    if (path === "/api/buyer/catalog") return ok({ offers: [] });
    return ok(quote);
  });
  const container = await mount(createElement(QuoteReview, { quoteId: "q1" }));
  const pay = [...container.querySelectorAll("button")].find((b) => /pay/i.test(b.textContent ?? ""));
  expect(pay).toBeTruthy();
  const loadsBefore = api.mock.calls.filter(([p]) => p === "/api/buyer/quote/q1").length;
  await act(async () => { pay!.click(); });
  const loadsAfter = api.mock.calls.filter(([p]) => p === "/api/buyer/quote/q1").length;
  expect(loadsAfter).toBe(loadsBefore + 1);
});

it("a paid payment links to its order without the caller passing a link", async () => {
  const view = { attemptId: "a1", quoteId: "q1", environment: "sandbox", state: "paid", tone: "success", headline: "Paid. Order #1009", detail: "", amount: "$95.00", approvalUrl: null, order: { id: "o9", number: 1009 }, next: ["view_order"] };
  const container = await mount(createElement(PaymentStatus, { view: view as never, onChange: () => {} }));
  expect(container.querySelector("a[href='/order/o9']")?.textContent).toContain("View your order");
});
