import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "@/components/buyer/thread";
vi.mock("@/components/assistant/conversation", () => ({ AssistantAnswer: () => null }));

function render(parts: UIMessage["parts"]) {
  return renderToStaticMarkup(createElement(Thread, { widget: false, messages: [{ id: "answer", role: "assistant", parts }], status: "ready", shopName: "Shop", inQuote: () => false, quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {} }));
}
describe("catalog evidence in the conversation", () => {
  it("shows the actual product rule beside the catalog result", () => {
    const html = render([{ type: "tool-browse_catalog", toolCallId: "catalog", state: "output-available", input: {}, output: { matchingFilters: 1, offers: [], sources: [{ id: "rule", revision: 6, title: "Mug care", topic: "general", body: "Hand wash this mug.", updatedAt: "2026-10-11T00:00:00Z", productId: "mug", validUntil: null, hasNextStep: false }] } }]);
    expect(html).toContain("Hand wash this mug."); expect(html).toContain("Version 6");
  });
  it("renders a refused knowledge read without crashing or claiming no knowledge exists", () => {
    const html = render([{ type: "tool-read_shop_guide", toolCallId: "guide", state: "output-available", input: {}, output: { error: "Published product not found" } }]);
    expect(html).toContain("Published product not found"); expect(html).not.toContain("No matching");
  });
});
