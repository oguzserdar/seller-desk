// @vitest-environment happy-dom
/** @fileoverview The cancel page offers PayPal or cancelling only while the checkout is open, and links back to the shop once. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PaymentView } from "../../src/server/payments/engine";

const attempt = "b4797b3d-b4b2-4b82-b0c2-c9d725e837a1";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ attempt }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const api = vi.fn();
vi.mock("../../src/lib/buyer-client", () => ({ api: (...args: unknown[]) => api(...args), readToken: () => "token" }));
const { CheckoutCancelled } = await import("../../src/app/checkout/cancel/checkout-cancelled");

const base: PaymentView = { attemptId: attempt, quoteId: "q", environment: "sandbox", state: "approval_pending" as PaymentView["state"],
  tone: "action", headline: "Approve the payment in PayPal", detail: "Nothing is charged until you approve.", amount: "$95.00",
  approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=T", order: null, next: ["approve_in_paypal", "cancel_checkout"] };

let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; vi.unstubAllGlobals(); });
async function show(view: PaymentView) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.mockResolvedValue({ data: view });
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root!.render(createElement(CheckoutCancelled)));
  return host;
}
const backLinks = (host: HTMLElement) => [...host.querySelectorAll("a")].filter((a) => a.textContent?.trim() === "Back to the shop").length;

it("offers PayPal or cancelling while the checkout is open", async () => {
  const host = await show(base);
  expect(host.textContent).toContain("You can go back to PayPal, or cancel this checkout");
  expect(backLinks(host)).toBe(1);
});

it("drops the stale choices and links back to the shop once after cancelling", async () => {
  const host = await show({ ...base, state: "cancelled" as PaymentView["state"], tone: "closed", headline: "Checkout cancelled",
    detail: "You have not been charged. Ask for a fresh quote to try again.", approvalUrl: null, next: ["requote"] });
  expect(host.textContent).toContain("Checkout cancelled");
  expect(host.textContent).not.toContain("You can go back to PayPal");
  expect(backLinks(host)).toBe(1);
});
