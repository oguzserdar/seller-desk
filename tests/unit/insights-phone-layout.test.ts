/**
 * @fileoverview Unit tests for the Insights phone layout.
 * @module tests/unit/insights-phone-layout
 *
 * stackForPhone puts every card full width in reading order and returns positions in the order
 * the cards were given; phonePageHeight sums the stacked heights.
 */
import { describe, expect, it } from "vitest";
import { insightsReport, phonePageHeight, phoneRows, stackForPhone } from "@/components/insights/studio-report";

describe("stackForPhone", () => {
  it("stacks cards full width top to bottom, then left to right, keeping the given order", () => {
    const cards = [
      { xTrack: 12, yTrack: 8, xSpan: 12, ySpan: 10 }, // right of the second row
      { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 }, // first row
      { xTrack: 0, yTrack: 8, xSpan: 12, ySpan: 6 }, // left of the second row
    ];
    expect(stackForPhone(cards, 24)).toEqual([
      { xTrack: 0, yTrack: 18, xSpan: 24, ySpan: 10 },
      { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 12 },
      { xTrack: 0, yTrack: 12, xSpan: 24, ySpan: 6 },
    ]);
  });

  it("gives a short full-width strip room for its figures to wrap", () => {
    expect(phoneRows({ xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 8 })).toBe(16);
    expect(phoneRows({ xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 8 })).toBe(8);
    expect(phoneRows({ xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 18 })).toBe(18);
  });

  it("sizes a stacked page to the sum of its phone heights", () => {
    const sales = insightsReport.pages.find((page) => page.id === "sales")!;
    const rows = Object.values(sales.widgetLayout ?? {}).reduce((total, item) => total + (item ? phoneRows(item) : 0), 0);
    expect(phonePageHeight(sales)).toBe(rows * 18 + 24);
  });
});
