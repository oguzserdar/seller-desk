// @vitest-environment happy-dom
/** @fileoverview Sidebar rows play their animated icon on hover and keyboard focus, and stay still for reduced-motion viewers. */
import { act, createElement, forwardRef, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const calls: string[] = [];
let reduced = false;
vi.mock("next/navigation", () => ({ usePathname: () => "/owner/orders" }));
vi.mock("motion/react", async (importOriginal) => ({ ...(await importOriginal<object>()), useReducedMotion: () => reduced }));
for (const [file, name] of [["inbox", "InboxIcon"], ["chat-bubble-left-right", "ChatBubbleLeftRightIcon"], ["cube", "CubeIcon"], ["book-open", "BookOpenIcon"], ["cog-6-tooth", "Cog6ToothIcon"], ["arrow-down-tray", "ArrowDownTrayIcon"]] as const) {
  vi.doMock(`../../src/components/animated-icons/${file}`, () => ({
    [name]: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ startAnimation: () => calls.push(`start ${name}`), stopAnimation: () => calls.push(`stop ${name}`) }));
      return createElement("span", { "data-icon": name });
    }),
  }));
}
const { OwnerNav } = await import("../../src/app/owner/(desk)/owner-nav");
const { SidebarProvider } = await import("../../src/components/shadcn/sidebar");

let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; calls.length = 0; reduced = false; vi.unstubAllGlobals(); });
async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(SidebarProvider, null, createElement(OwnerNav))));
  return [...host.querySelectorAll("a")].find((a) => a.textContent === "Offers")!;
}

it("plays the row's icon on keyboard focus and hover, and settles it on leave", async () => {
  const offers = await render();
  await act(async () => { offers.dispatchEvent(new FocusEvent("focus", { bubbles: false })); offers.focus(); });
  expect(calls).toContain("start CubeIcon");
  await act(async () => { offers.blur(); });
  expect(calls).toContain("stop CubeIcon");
  calls.length = 0;
  await act(async () => { offers.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  expect(calls).toEqual(["start CubeIcon"]);
});

it("keeps the icon still for viewers who prefer reduced motion", async () => {
  reduced = true;
  const offers = await render();
  await act(async () => { offers.focus(); offers.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  expect(calls.filter((c) => c.startsWith("start"))).toEqual([]);
});
