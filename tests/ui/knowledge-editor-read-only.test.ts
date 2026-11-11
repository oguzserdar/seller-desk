// @vitest-environment happy-dom
/**
 * The knowledge list: one clear count, the topic and scope on one line, and no add, edit or history
 * controls for a demo visitor.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../src/app/owner/(desk)/knowledge/actions", () => ({}));
vi.mock("next-safe-action/hooks", () => ({ useAction: () => ({ execute: vi.fn(), isPending: false, result: {} }) }));

import { KnowledgeEditor } from "../../src/app/owner/(desk)/knowledge/knowledge-editor";

const entry = (id: string, published: boolean) => ({ id, title: `Fact ${id}`, body: "Body", topic: "general" as const, published, actionLabel: "", actionUrl: "", productId: null, validUntil: null });
let root: Root;
let container: HTMLDivElement;
async function render(readOnly: boolean) {
  await act(async () => {
    root.render(createElement(KnowledgeEditor, { readOnly, expiredIds: [], entries: [entry("a", true), entry("b", false)], removedEntries: [], products: [] }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("counts live facts once and names the limit only for the owner", async () => {
  await render(false);
  expect(container.textContent).toContain("1 published, 1 not live · up to");
  expect(container.textContent).toContain("Whole shop");
  expect(container.textContent).not.toMatch(/\b0\b/);
});

it("gives a demo visitor no add, edit or history controls", async () => {
  await render(true);
  const labels = [...container.querySelectorAll("button")].map((button) => button.textContent ?? "");
  expect(labels.some((text) => /Add knowledge|Edit|History/.test(text))).toBe(false);
  expect(container.textContent).not.toContain("up to");
});
