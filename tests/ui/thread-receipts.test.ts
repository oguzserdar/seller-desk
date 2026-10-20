/**
 * Finished steps in one assistant turn read as one quiet line, not a tool log.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { Thread } from "../../src/components/buyer/thread";

const turn = (parts: unknown[]): UIMessage => ({ id: "a1", role: "assistant", parts } as UIMessage);
const render = (message: UIMessage) => renderToStaticMarkup(createElement(Thread, {
  widget: false, messages: [message], status: "ready", shopName: "Spoke Street", inQuote: () => false,
  quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {},
}));

describe("assistant step receipts", () => {
  it("back-to-back finished steps join into one line", () => {
    const html = render(turn([
      { type: "step-start" },
      { type: "tool-my_orders", toolCallId: "t1", state: "output-available", input: {}, output: {} },
      { type: "step-start" },
      { type: "tool-shop_terms", toolCallId: "t2", state: "output-available", input: {}, output: {} },
      { type: "text", text: "Order 1001 is paid." },
    ]));
    expect(html.match(/class="assistant-receipt"/g)).toHaveLength(1);
    expect(html).toContain("Checked your orders · Read the shop&#x27;s terms");
  });

  it("a guide lookup that found no notes does not split the line (real 11 Oct turn)", () => {
    const html = render(turn([
      { type: "step-start" },
      { type: "tool-my_orders", toolCallId: "t1", state: "output-available", input: {}, output: {} },
      { type: "tool-read_shop_guide", toolCallId: "t2", state: "output-available", input: {}, output: { sources: [] } },
      { type: "tool-shop_terms", toolCallId: "t3", state: "output-available", input: {}, output: {} },
      { type: "step-start" },
      { type: "text", text: "Order 1001 is paid." },
    ]));
    expect(html.match(/class="assistant-receipt"/g)).toHaveLength(1);
  });

  it("a step the assistant retried successfully in the same turn shows only the success (real 14 Oct turn)", () => {
    const html = render(turn([
      { type: "tool-ask_seller", toolCallId: "t1", state: "output-error", input: {}, errorText: "Input too long" },
      { type: "tool-ask_seller", toolCallId: "t2", state: "output-available", input: {}, output: { question: "Can you do the front cable and front pads by Tuesday?" } },
      { type: "text", text: "I asked the shop." },
    ]));
    expect(html).not.toContain("Could not");
    expect(html).toContain("Asked Spoke Street");
  });

  it("a question that really failed says it was not sent, not that the shop was unreachable", () => {
    const html = render(turn([
      { type: "tool-ask_seller", toolCallId: "t1", state: "output-error", input: {}, errorText: "Input too long" },
      { type: "text", text: "I could not send that." },
    ]));
    expect(html).toContain("Could not send your question to the shop");
    expect(html).not.toContain("reach the shop");
  });

  it("a receipt after the answer stays separate from one before it", () => {
    const html = render(turn([
      { type: "tool-my_orders", toolCallId: "t1", state: "output-available", input: {}, output: {} },
      { type: "text", text: "Order 1001 is paid." },
      { type: "tool-shop_terms", toolCallId: "t2", state: "output-available", input: {}, output: {} },
    ]));
    expect(html.match(/class="assistant-receipt"/g)).toHaveLength(2);
  });
});
