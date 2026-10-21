/** @fileoverview A shop without a connected store never shows the buyer a store failure line. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

const searched = (status: "disconnected" | "unavailable"): UIMessage => ({ id: "a1", role: "assistant", parts: [
  { type: "tool-search_store_products", toolCallId: "t1", state: "output-available", input: {}, output: { status, connection: null, host: null, checkedAt: null, products: [], page: 1, hasMore: false, message: "" } },
  { type: "text", text: "Sí, tenemos una luz delantera." },
] } as UIMessage);
const thread = (message: UIMessage) => renderToStaticMarkup(createElement(Thread, {
  widget: false, messages: [message], status: "ready", shopName: "Spoke Street Cycles", inQuote: () => false,
  quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {},
}));

describe("connected store receipts", () => {
  it("says nothing when no store is connected", () => {
    expect(thread(searched("disconnected"))).not.toContain("Could not verify");
  });
  it("still says when a connected store could not be checked", () => {
    expect(thread(searched("unavailable"))).toContain("Could not verify the connected store");
  });
});
