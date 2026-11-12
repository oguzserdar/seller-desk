// @vitest-environment happy-dom
/**
 * @fileoverview Payment return page: one failed check does not replace the payment's status with an
 * error; the page keeps checking and keeps what PayPal last said.
 * @module tests/ui/checkout-return-retry
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api, readToken: () => ({ token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("attempt=11111111-2222-3333-4444-555555555555") }));
import { CheckoutReturn } from "../../src/app/checkout/return/checkout-return";

afterEach(() => { api.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const progress = { attemptId: "a", quoteId: "q", environment: "sandbox", state: "capturing", tone: "progress", headline: "PayPal is confirming your payment", detail: "", amount: "$95.00", approvalUrl: null, order: null, next: ["check_status"] };

it("keeps the last status and keeps checking after one failed check", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api
    .mockResolvedValueOnce({ data: progress, httpStatus: 200, message: "OK" })
    .mockResolvedValueOnce({ data: null, httpStatus: 500, message: "Something went wrong." })
    .mockResolvedValue({ data: progress, httpStatus: 200, message: "OK" });
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => { createRoot(container).render(createElement(CheckoutReturn)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(container.textContent).toContain("PayPal is confirming your payment");
  expect(container.textContent).not.toContain("Back to the shop");
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(api.mock.calls.length).toBeGreaterThanOrEqual(3);
});
