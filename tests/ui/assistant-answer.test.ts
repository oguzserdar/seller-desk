import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantAnswer } from "../../src/components/assistant/conversation";

const render = (text: string, streaming = false) => renderToStaticMarkup(createElement(AssistantAnswer, { text, streaming }));

describe("untrusted assistant prose", () => {
  it("renders lists and emphasis without flattening the answer", () => {
    const html = render("**Pickup**\n\n1. Bring the receipt\n2. Ask at the counter");
    expect(html).toContain("<strong");
    expect(html).toContain("<ol");
    expect(html).toContain("Bring the receipt");
  });

  it("does not turn model links into checkout or navigation controls", () => {
    const html = render("[Pay here](https://untrusted.example/pay) and [open an order](/order/invented). [run](javascript:alert%281%29)");
    expect(html).toContain("Pay here");
    expect(html).not.toMatch(/<a[\s>]|href=|javascript:/i);
  });

  it("cannot load tracking media or execute raw HTML", () => {
    const html = render('![tracking](https://untrusted.example/pixel)\n\n<img src="https://untrusted.example/raw" onerror="alert(1)">\n\n<script>alert(1)</script>\n\nA safe answer.');
    expect(html).toContain("A safe answer.");
    expect(html).not.toMatch(/<img|<script|<link|<iframe/i);
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves a long order reference and accepts an unfinished streaming answer", () => {
    const ref = "a1b2c3d4e5".repeat(14);
    expect(render(`Reference: \`${ref}\``)).toContain(ref);
    const html = render("Here is **your answer", true);
    expect(html).toContain("your answer");
    expect(html).not.toMatch(/<script|<iframe/);
  });
});
