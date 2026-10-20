// @vitest-environment happy-dom
/** Explicit confirmation and stale drafts are tested separately from browser visual acceptance. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { OrderHelp } from "@/components/order-help";
import type { OrderFollowupView } from "@/lib/order-followup";

afterEach(() => vi.unstubAllGlobals());
const waiting: OrderFollowupView = { state: "awaiting_customer", revision: 2, nextActor: "buyer", earlierMessages: false, history: [
  { actor: "buyer", state: "needs_help", revision: 1, message: "My purchased file will not open.", at: "2026-10-11T12:00:00Z" },
  { actor: "owner", state: "awaiting_customer", revision: 2, message: "Try opening the ZIP with your file manager.", at: "2026-10-11T12:01:00Z" },
] };
function button(container: HTMLElement, text: string) { const found = [...container.querySelectorAll("button")].find(b => b.textContent === text); if (!found) throw new Error(`Missing ${text}`); return found; }
function edit(container: HTMLElement, text: string) {
  const node = container.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, text);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

it("shows the actual seller reply without auto-confirming and never offers seller-side resolution", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const send = vi.fn().mockResolvedValue(undefined);
  try {
    await act(async () => root.render(createElement(OrderHelp, { audience: "buyer", view: waiting, onSend: send, onRefresh: async () => {} })));
    expect(container.textContent).toContain(waiting.history[1]!.message);
    expect(send).not.toHaveBeenCalled();
    await act(async () => button(container, "This problem is resolved").click());
    expect(send).toHaveBeenCalledExactlyOnceWith({ action: "confirm", expectedRevision: 2 });
    await act(async () => root.render(createElement(OrderHelp, { audience: "owner", view: waiting, onSend: send, onRefresh: async () => {} })));
    expect(container.textContent).toContain("The customer has not confirmed a resolution");
    expect([...container.querySelectorAll("button")].some(b => b.textContent === "This problem is resolved")).toBe(false);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("preserves unsent words on lost response and refuses to silently adopt a newer revision", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const send = vi.fn().mockRejectedValue(new Error("Connection lost. Try again."));
  const render = async (view: OrderFollowupView) => { await act(async () => root.render(createElement(OrderHelp, { audience: "buyer", view, onSend: send, onRefresh: async () => {} }))); };
  try {
    await render(waiting);
    await act(async () => button(container, "I still need help").click());
    await act(async () => edit(container, "It still will not open after trying that."));
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(send).toHaveBeenCalledWith({ action: "help", expectedRevision: 2, message: "It still will not open after trying that." });
    expect(container.querySelector("textarea")?.value).toBe("It still will not open after trying that.");
    expect(container.textContent).toContain("Connection lost");
    await render({ ...waiting, revision: 4 });
    expect(button(container, "Send to the shop").disabled).toBe(true);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Reply to the latest message").click());
    send.mockResolvedValue(undefined);
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(send).toHaveBeenLastCalledWith({ action: "help", expectedRevision: 4, message: "It still will not open after trying that." });
    expect(container.querySelector("textarea")).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
