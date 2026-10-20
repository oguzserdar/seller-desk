// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/buyer-client", () => ({ api }));
vi.mock("@/components/assistant/conversation", () => ({ AssistantAnswer: () => null }));
const ok = (id: string) => ({ data: { id, accessKey: `key-for-${id}` }, httpStatus: 200, message: "OK" });
let root: Root;
let container: HTMLDivElement;

function render(widget: boolean, orderId = "order-one") {
  const messages: UIMessage[] = [{ id: "reply", role: "assistant", parts: [
    { type: "tool-check_payment", toolCallId: "check", state: "output-available", input: {}, output: { verified: true, order: { id: orderId, number: 1004 } } },
    { type: "tool-restore_download", toolCallId: "restore", state: "output-available", input: { orderId }, output: { outcome: "granted" } },
  ] }];
  return act(async () => { root.render(createElement(Thread, { widget, messages, status: "ready", shopName: "Shop", inQuote: () => false,
    quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {} })); });
}

describe("order links in widget tool results", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    api.mockResolvedValue(ok("order-one"));
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); }); container.remove(); api.mockReset(); vi.unstubAllGlobals();
  });

  it("keeps both verified-payment and recovered-download receipts outside the widget with order-scoped access", async () => {
    await render(true);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/order/"]')];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
      expect(link.rel).toContain("noreferrer");
      expect(link.getAttribute("href")).toBe("/order/order-one#key=key-for-order-one");
      expect(link.textContent).toContain("new tab");
    }
    expect(api.mock.calls.every(([path]) => path === "/api/buyer/orders/order-one")).toBe(true);
  });

  it("keeps full-page navigation direct without fetching another credential", async () => {
    await render(false);
    expect(api).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('a[href="/order/order-one"]')]).toHaveLength(2);
  });

  it("does not expose a working link after refused access and lets the buyer retry", async () => {
    api.mockResolvedValue({ data: null, httpStatus: 404, message: "Order not found" });
    await render(true);
    expect(container.querySelector('a[href^="/order/"]')).toBeNull();
    expect(container.textContent).toContain("Could not open this order");
    api.mockResolvedValue(ok("order-one"));
    await act(async () => { container.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(container.querySelector('a[href="/order/order-one#key=key-for-order-one"]')).not.toBeNull();
  });

  it("discards delayed credentials for an old order and rejects a mismatched reply", async () => {
    const pending: ((value: ReturnType<typeof ok>) => void)[] = [];
    api.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    await render(true);
    api.mockResolvedValue(ok("wrong-order"));
    await render(true, "order-two");
    await act(async () => { pending.forEach(resolve => resolve(ok("order-one"))); });
    expect(container.querySelector('a[href^="/order/"]')).toBeNull();
    expect(container.textContent).toContain("Could not open this order");
  });
});
