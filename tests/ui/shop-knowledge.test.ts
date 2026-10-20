import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KnowledgeSources, ShopNextStep } from "../../src/components/buyer/shop-knowledge";

describe("source evidence and external next steps", () => {
  it("uses a versioned local destination and describes a handoff, never completion", () => {
    const html = renderToStaticMarkup(createElement(ShopNextStep, { step: { id: "source-id", revision: 3, title: "Returns", label: "Request an exchange", host: "example.com" } }));
    expect(html).toContain('href="/shop-step/source-id?revision=3"');
    expect(html).toContain("You review and complete the next step there.");
    expect(html).not.toContain("https://example.com");
    expect(html).toContain('rel="noreferrer"');
  });

  it("renders exactly the public source and escapes any HTML or links in its text", () => {
    const html = renderToStaticMarkup(createElement(KnowledgeSources, { sources: [{ id: "note", revision: 2, title: "Returns", topic: "returns", body: '<script>alert(1)</script> https://bad.example/pay', updatedAt: "2026-10-09T00:00:00Z", hasNextStep: false, productId: null, validUntil: null }] }));
    expect(html).toContain("Version 2");
    expect(html).toContain("Updated 2026-10-09");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script|href=/);
  });
});
