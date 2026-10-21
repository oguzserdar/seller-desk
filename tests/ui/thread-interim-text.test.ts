/** @fileoverview A preview written before a later tool step is not repeated above the final answer. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatStatus, UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

const offers = { type: "tool-show_offers", toolCallId: "t1", state: "output-available", input: {}, output: { offers: [] } };
const reply = (parts: unknown[]): UIMessage => ({ id: "a1", role: "assistant", parts } as UIMessage);
const html = (message: UIMessage, status: ChatStatus = "ready") => renderToStaticMarkup(createElement(Thread, {
  widget: false, messages: [message], status, shopName: "Spoke Street Cycles", inQuote: () => false,
  quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {},
}));

describe("interim assistant text", () => {
  it("drops the preview once a final answer follows the tool step", () => {
    const out = html(reply([{ type: "text", text: "Only one exists. Showing it now." }, offers, { type: "text", text: "Only one can be sold." }]));
    expect(out).not.toContain("Showing it now");
    expect(out).toContain("Only one can be sold.");
  });
  it("keeps the text when no answer follows, so nothing is lost", () => {
    expect(html(reply([{ type: "text", text: "Here is what I found." }, offers]))).toContain("Here is what I found.");
  });
  it("keeps a plain answer with no later tool step", () => {
    expect(html(reply([offers, { type: "text", text: "Two gifts fit." }]))).toContain("Two gifts fit.");
  });
});
