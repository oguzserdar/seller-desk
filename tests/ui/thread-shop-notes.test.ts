// @vitest-environment happy-dom
/**
 * One answer shows its shop notes once, even when two tools (catalog browse and
 * shop guide) both attach the same notes, as chat assistants show one sources
 * entry per answer.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

vi.mock("@/lib/buyer-client", () => ({ api: vi.fn() }));
vi.mock("@/components/assistant/conversation", () => ({ AssistantAnswer: () => null }));
const note = (id: string) => ({ id, title: `Note ${id}`, topic: "faq", revision: 1, updatedAt: "2026-10-01T00:00:00Z", body: "Text" });
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals();
});

it("merges notes from several tools into one entry", async () => {
  const messages: UIMessage[] = [{ id: "reply", role: "assistant", parts: [
    { type: "tool-browse_catalog", toolCallId: "browse", state: "output-available", input: {}, output: { matchingFilters: 6, narrowedBySearch: false, offers: [], sources: [note("a"), note("b"), note("c")] } },
    { type: "tool-read_shop_guide", toolCallId: "guide", state: "output-available", input: {}, output: { sources: [note("b"), note("c"), note("d")] } },
  ] }];
  await act(async () => { root.render(createElement(Thread, { widget: false, messages, status: "ready", shopName: "Shop", inQuote: () => false,
    quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {} })); });
  const summaries = [...container.querySelectorAll("summary")].map((s) => s.textContent);
  expect(summaries).toEqual(["Read 4 shop notes"]);
});
