// @vitest-environment happy-dom
/** @fileoverview Payment cards must describe their evidence without inventing provider confirmation. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "@/components/buyer/thread";

vi.mock("@/components/assistant/conversation", () => ({ AssistantAnswer: () => null }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function show(output?: Record<string, unknown>) {
  const part = output
    ? { type: "tool-check_payment", toolCallId: "check", state: "output-available", input: {}, output }
    : { type: "tool-check_payment", toolCallId: "check", state: "output-error", input: {}, errorText: "Connection ended" };
  const messages = [{ id: "reply", role: "assistant", parts: [part] }] as UIMessage[];
  await act(async () => root.render(createElement(Thread, { widget: false, messages, status: "ready", shopName: "Shop",
    inQuote: () => false, quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {} })));
  return container.textContent!;
}
it("labels a stored sandbox confirmation and gives its receipt without implying a fresh PayPal lookup", async () => {
  const text = await show({ verified: true, environment: "sandbox", checkType: "stored_record", amount: "$115.00", order: { id: "order-one", number: 1004 } });
  expect(text).toContain("Saved payment confirmation");
  expect(text).toContain("PayPal sandbox · Test money only");
  expect(text).toContain("Order #1004");
  expect(text).toContain("No need to pay again");
  expect(container.querySelector('a[href="/order/order-one"]')).not.toBeNull();
});
it("does not present a simulated payment as PayPal confirmation", async () => {
  const text = await show({ verified: true, environment: "fixture", checkType: "reconciliation_attempt", amount: "$115.00", order: null });
  expect(text).toContain("Simulated payment");
  expect(text).toContain("No real money moved");
  expect(text).not.toContain("PayPal confirmed");
  expect(text).not.toContain("Checked with PayPal");
});
it("shows confirmation after reconciliation without claiming a new provider request", async () => {
  const text = await show({ verified: true, environment: "sandbox", checkType: "reconciliation_attempt", amount: "$115.00", order: { id: "order-one", number: 1004 } });
  expect(text).toContain("Payment confirmed");
  expect(text).not.toContain("Checked with PayPal");
});
it("never turns an interrupted check into a no-charge guarantee", async () => {
  const text = await show();
  expect(text).toContain("could not finish");
  expect(text).toContain("Do not pay again");
  expect(text).not.toContain("Nothing was charged");
});
it("keeps pending payment unresolved without offering a receipt", async () => {
  const text = await show({ verified: false, environment: "sandbox", checkType: "reconciliation_attempt", status: "Payment pending at PayPal", detail: "PayPal is still processing this payment." });
  expect(text).toContain("Payment pending at PayPal");
  expect(text).not.toContain("Payment confirmed");
  expect(container.querySelector('a[href^="/order/"]')).toBeNull();
});
it("does not invent evidence provenance for an older saved result", async () => {
  const text = await show({ verified: true, amount: "$115.00", order: { id: "order-one", number: 1004 } });
  expect(text).toContain("Payment confirmation recorded");
  expect(text).not.toContain("Checked with PayPal");
  expect(text).not.toContain("PayPal confirmed");
});
