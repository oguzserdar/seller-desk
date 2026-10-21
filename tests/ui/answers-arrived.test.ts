// @vitest-environment happy-dom
/** @fileoverview The thread follows to the shop's answer only when a waiting question becomes answered. */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAnswersArrived } from "../../src/components/buyer/shop-handoff";

it("counts each open → answered change, and nothing else", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let seen = -1;
  const Probe = ({ state }: { state?: string }) => { seen = useAnswersArrived(state); return null; };
  const show = (state?: string) => act(async () => root.render(createElement(Probe, { state })));
  try {
    await show(undefined); expect(seen).toBe(0);
    await show("answered"); expect(seen).toBe(0); // already answered on load: not news
    await show("open"); expect(seen).toBe(0);
    await show("answered"); expect(seen).toBe(1);
    await show("answered"); expect(seen).toBe(1);
    await show("open"); await show("answered"); expect(seen).toBe(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
