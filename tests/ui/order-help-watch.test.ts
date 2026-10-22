// @vitest-environment happy-dom
/** @fileoverview A buyer waiting on the shop gets the reply without pressing a button; the owner view does not poll. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrderHelp } from "../../src/components/order-help";
import type { OrderFollowupView } from "../../src/lib/order-followup";

const waiting: OrderFollowupView = { state: "needs_help", revision: 1, nextActor: "seller", earlierMessages: false,
  history: [{ revision: 1, actor: "buyer", state: "needs_help", message: "The zip will not open.", at: "2026-10-21T10:00:00Z" }] };
const replied: OrderFollowupView = { ...waiting, state: "awaiting_customer", revision: 2, nextActor: "buyer",
  history: [...waiting.history, { revision: 2, actor: "owner", state: "awaiting_customer", message: "Open it in Files.", at: "2026-10-21T10:05:00Z" }] };

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const show = (audience: "buyer" | "owner", view: OrderFollowupView, onRefresh: () => Promise<void>) =>
  act(async () => root.render(createElement(OrderHelp, { audience, view, onRefresh, onSend: async () => {} })));

it("checks for the shop's reply on its own while the buyer waits", async () => {
  const onRefresh = vi.fn(async () => {});
  await show("buyer", waiting, onRefresh);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(onRefresh).toHaveBeenCalledTimes(2);
});

it("stops checking once the reply has arrived", async () => {
  const onRefresh = vi.fn(async () => {});
  await show("buyer", waiting, onRefresh);
  await show("buyer", replied, onRefresh);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(onRefresh).not.toHaveBeenCalled();
});

it("does not poll the owner's view", async () => {
  const onRefresh = vi.fn(async () => {});
  await show("owner", waiting, onRefresh);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(onRefresh).not.toHaveBeenCalled();
});
