/** @fileoverview A customer waiting on the shop sees one calm wait card, never the same wait said three times. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";
import { SellerReply } from "../../src/components/buyer/seller-reply";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";

const asked: UIMessage = { id: "a1", role: "assistant", parts: [
  { type: "tool-ask_seller", toolCallId: "t1", state: "output-available", input: {}, output: { question: "Can you replace a frayed front brake cable by Tuesday?", status: "waiting" } },
  { type: "text", text: "I asked the shop and will show their answer here." },
] } as UIMessage;
const thread = (waitingOnShop: boolean) => renderToStaticMarkup(createElement(Thread, {
  widget: false, messages: [asked], status: "ready", shopName: "Spoke Street Cycles", inQuote: () => false,
  quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {}, waitingOnShop,
}));

describe("waiting on the shop", () => {
  it("turns the question into one wait card while the shop has not answered", () => {
    const html = thread(true);
    expect(html).toContain("Asked Spoke Street Cycles");
    expect(html).toContain("Waiting for the owner");
    expect(html).toContain("close the page and come back");
    expect(html).toContain('role="status"');
    expect(html).toContain("Can you replace a frayed front brake cable by Tuesday?");
  });
  it("keeps the question as a plain record once the shop has answered", () => {
    const html = thread(false);
    expect(html).not.toContain("Waiting for");
    expect(html).not.toContain("come back");
    expect(html).toContain("Asked Spoke Street Cycles");
  });
  it("does not repeat the wait above the conversation", () => {
    const html = renderToStaticMarkup(createElement(SellerReply, { handoff: { question: "q", answer: null, state: "open", retrying: false }, shopName: "Spoke Street Cycles", canContinue: false, onContinue: () => {} }));
    expect(html).toBe("");
  });
});

it("says an empty quote is empty instead of pointing at items that are not there", () => {
  const html = renderToStaticMarkup(createElement(QuoteSummary, { quote: null } as unknown as Parameters<typeof QuoteSummary>[0]));
  expect(html).toContain("Your quote is empty.");
  expect(html).not.toContain("Items you choose appear here");
});
