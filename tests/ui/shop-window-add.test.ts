// @vitest-environment happy-dom
/** @fileoverview The shop's first screen lets a buyer add a priced product straight to the quote, keeps asking one tap away, and sends unpriced work to the assistant. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PublicOffer } from "../../src/server/domain/offers";

vi.mock("next/image", () => ({ default: () => createElement("span") }));
const { ShopWindow } = await import("../../src/components/buyer/shop-window");

const offer = (id: string, title: string, unitAmountMinor: number | null, available: number | null = 3) =>
  ({ id, kind: unitAmountMinor === null ? "service" : "goods", title, unitAmountMinor, currency: "USD", available, maxQuantity: 5, requiresScopeReview: unitAmountMinor === null, imagePath: null }) as unknown as PublicOffer;
const offers = [{ ...offer("light", "Front light", 9500), imagePath: "/offers/light.jpg" } as PublicOffer, offer("repair", "Custom repair", null), offer("pads", "Brake pads", 3500, 0)];

let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

async function render({ assistantOn = true, added = [] as string[] } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(ShopWindow, {
    shopName: "Spoke Street Cycles", offers, assistantOn, composer: null, busy: false,
    inQuote: (id: string) => added.includes(id),
    onSuggestion: () => {}, onAdd: (o: PublicOffer) => calls.push(`add ${o.id}`), onAsk: (o: PublicOffer) => calls.push(`ask ${o.id}`),
  })));
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label)!;
  return { calls, button, host };
}

it("adds a priced product without asking the assistant, and keeps Ask beside it", async () => {
  const { calls, button } = await render();
  await act(async () => button("Add Front light to your quote, $95.00").click());
  await act(async () => button("Ask about Front light").click());
  expect(calls).toEqual(["add light", "ask light"]);
});

it("sends work without a price to the assistant, since the shop has to scope it", async () => {
  const { calls, button } = await render();
  expect(button("Add Custom repair to your quote, Awaiting quote")).toBeUndefined();
  await act(async () => button("Ask about Custom repair").click());
  expect(calls).toEqual(["ask repair"]);
});

it("does not add a sold-out product or one already in the quote", async () => {
  const { calls, button } = await render({ added: ["light"] });
  await act(async () => button("Front light is in your quote").click());
  const soldOut = button("Brake pads is sold out");
  expect(soldOut.disabled).toBe(true);
  expect(soldOut.querySelector("svg")).toBeNull();
  await act(async () => soldOut.click());
  expect(calls).toEqual([]);
});

it("offers no Ask button when the shop's assistant is off", async () => {
  const { calls, button } = await render({ assistantOn: false });
  expect(button("Ask about Front light")).toBeUndefined();
  await act(async () => button("Add Custom repair to your quote, Awaiting quote").click());
  expect(calls).toEqual(["add repair"]);
});

it("gives a product without a photo an icon panel, which a phone hides", async () => {
  const { host } = await render();
  const panels = host.querySelectorAll(".bg-photo");
  expect(panels.length).toBeGreaterThan(1);
  // One real photo; every other panel is the stand-in, hidden with its wrapper on a phone.
  expect(host.querySelectorAll(".bg-photo:not([data-no-photo])")).toHaveLength(1);
  for (const panel of host.querySelectorAll("[data-no-photo]")) {
    expect(panel.querySelector("svg")).not.toBeNull();
    expect(panel.closest("article")?.className).toContain("max-sm:[&>div:has([data-no-photo])]:hidden");
  }
});
