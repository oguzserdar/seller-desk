// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteReview } from "../../src/app/quote/[id]/quote-review";
import { OrderStatus } from "../../src/app/order/[id]/order-status";

const { api, takeFragmentParam, saveToken } = vi.hoisted(() => ({ api: vi.fn(), takeFragmentParam: vi.fn(), saveToken: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api, takeFragmentParam, saveToken, readToken: () => ({ token: "test" }) }));
const ok = (data: unknown) => ({ data, httpStatus: 200, message: "OK" });
let root: Root;
let container: HTMLDivElement;

describe("opening a paid order from its quote handoff", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window.location, "replace").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    api.mockReset(); takeFragmentParam.mockReset(); saveToken.mockReset();
  });

  it("exchanges the one-time link, then opens the server-authorized order directly", async () => {
    takeFragmentParam.mockReturnValue("test-code");
    api.mockImplementation(async (path: string) => {
      if (path === "/api/buyer/handoff/exchange") return ok({ token: "new-scope", expiresAt: "2099-01-01" });
      if (path === "/api/buyer/catalog") return ok({ offers: [] });
      if (path.startsWith("/api/buyer/payment")) return ok({ state: "paid", next: ["view_order"], tone: "success", headline: "Paid", detail: "Confirmed", environment: "fixture" });
      return ok({ id: "quote", status: "consumed", isLatest: true, lines: [], charges: [], unresolved: [], currency: "USD", totalMinor: 2500,
        policy: { sellerName: "Test shop", cancellationPolicy: "Contact shop", taxPolicy: "Included" },
        order: { id: "authorized-order", number: 1019 }, payment: { state: "paid", attemptId: "attempt" } });
    });
    await act(async () => { root.render(createElement(QuoteReview, { quoteId: "quote" })); });
    expect(saveToken).toHaveBeenCalledWith({ token: "new-scope", expiresAt: "2099-01-01" });
    expect(window.location.replace).toHaveBeenCalledWith("/order/authorized-order");
  });

  it("never follows a requested quote when its handoff is rejected", async () => {
    takeFragmentParam.mockReturnValue("expired-code");
    api.mockResolvedValue({ data: null, httpStatus: 401, message: "This link has expired." });
    await act(async () => { root.render(createElement(QuoteReview, { quoteId: "quote" })); });
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This link has expired.");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("keeps the paid service scope visible on the receipt", async () => {
    takeFragmentParam.mockReturnValue(null);
    api.mockResolvedValue(ok({ id: "service-order", number: 1003, sellerName: "Repair shop", environment: "fixture", tasks: [], downloads: [], images: {},
      followup: { state: "none", revision: 0, nextActor: null, history: [], earlierMessages: false },
      snapshot: { lines: [], totalMinor: 13500, currency: "USD", policy: {}, approvedScope: "Repair two legs without sanding the original finish." } }));
    await act(async () => { root.render(createElement(OrderStatus, { orderId: "service-order" })); });
    expect(container.textContent).toContain("Confirmed work");
    expect(container.textContent).toContain("Repair two legs without sanding the original finish.");
  });
});
