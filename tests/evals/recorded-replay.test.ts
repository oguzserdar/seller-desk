/**
 * Recorded replays: real assistant turns saved from the live sandbox shop are
 * rendered by the buyer thread exactly as stored, so rendering is checked
 * against the shapes the model and AI SDK really produce. No model is called.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

const recorded = (name: string): UIMessage => ({
  id: name, role: "assistant",
  parts: JSON.parse(readFileSync(new URL(`../fixtures/recorded/buyer-${name}.json`, import.meta.url), "utf8")),
} as UIMessage);
const render = (message: UIMessage) => renderToStaticMarkup(createElement(Thread, {
  widget: false, messages: [message], status: "ready", shopName: "Spoke Street Cycles", inQuote: () => false,
  quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {},
}));
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const finalText = (message: UIMessage) => message.parts.filter((p) => p.type === "text").at(-1) as { text: string };

describe("recorded live turns render as the buyer should see them", () => {
  for (const name of ["offers-and-quote", "offers-no-quote", "ask-seller", "orders-check", "interim-preview"])
    it(`${name}: shows the final answer and leaks no tool payloads`, () => {
      const message = recorded(name);
      const text = visibleText(render(message));
      expect(text).toContain(finalText(message).text.split("\n")[0]!.replace(/\*\*/g, "").slice(0, 40));
      expect(text).not.toMatch(/"type":|tool-[a-z_]+|undefined|\[object Object\]/);
    });

  it("offers-and-quote: shows the offer cards and the quote receipt", () => {
    const html = render(recorded("offers-and-quote"));
    expect(html).toContain("offer-card");
    expect(visibleText(html)).toMatch(/Quote updated: \d+ items?/);
  });

  it("ask-seller: shows the sent question card", () => {
    expect(visibleText(render(recorded("ask-seller")))).toContain("Asked Spoke Street Cycles");
  });

  it("orders-check: shows that the orders were checked", () => {
    expect(visibleText(render(recorded("orders-check")))).toContain("Checked your orders");
  });
});
