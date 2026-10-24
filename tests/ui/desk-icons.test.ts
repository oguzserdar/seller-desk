// @vitest-environment happy-dom
/** @fileoverview Seller Desk's own sidebar icons render, play through their handle, and keep each mask private to its icon. */
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as icons from "../../src/components/desk-icons";
import type { DeskIconHandle } from "../../src/components/desk-icons";

let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; vi.unstubAllGlobals(); });

async function mount(children: ReturnType<typeof createElement>[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement("div", null, ...children)));
  return host;
}

const ICONS = [icons.DeskIcon, icons.ConversationsIcon, icons.OffersIcon, icons.KnowledgeIcon, icons.SetupIcon, icons.InstallIcon];

it("draws all six at the asked size and plays each one through its handle", async () => {
  const refs = ICONS.map(() => createRef<DeskIconHandle>());
  const host = await mount(ICONS.map((Icon, i) => createElement(Icon, { key: i, ref: refs[i], size: 20 })));
  const svgs = host.querySelectorAll("svg");
  expect(svgs).toHaveLength(6);
  svgs.forEach((svg) => expect(svg.getAttribute("width")).toBe("20"));
  await act(async () => { refs.forEach((ref) => { ref.current!.startAnimation(); ref.current!.stopAnimation(); }); });
});

it("gives every Knowledge icon its own mask, so two on one page do not share one", async () => {
  const host = await mount([createElement(icons.KnowledgeIcon, { key: "a" }), createElement(icons.KnowledgeIcon, { key: "b" })]);
  const ids = [...host.querySelectorAll("mask")].map((mask) => mask.id);
  expect(new Set(ids).size).toBe(2);
  host.querySelectorAll("g[mask]").forEach((g, i) => expect(g.getAttribute("mask")).toBe(`url(#${ids[i]})`));
});
