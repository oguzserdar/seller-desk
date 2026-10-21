/** @fileoverview Start over can be undone for a few seconds instead of losing the quote to one click. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuoteSummary } from "../../src/components/buyer/quote-summary";

type Props = Parameters<typeof QuoteSummary>[0];
const empty = (extra: Partial<Props>) => renderToStaticMarkup(createElement(QuoteSummary, { quote: null, ...extra } as unknown as Props));

describe("emptied quote", () => {
  it("offers Undo right after Start over", () => {
    const html = empty({ onUndoStartOver: () => {} });
    expect(html).toContain("Quote emptied.");
    expect(html).toContain("Undo");
  });
  it("shows the plain empty state otherwise", () => {
    const html = empty({ onUndoStartOver: null });
    expect(html).toContain("Your quote is empty.");
    expect(html).not.toContain("Undo");
  });
});
