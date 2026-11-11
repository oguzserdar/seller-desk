/**
 * @fileoverview Unit tests for turning Studio's references into dashboard names.
 * @module tests/unit/studio-refs
 *
 * Covers fields, named measures, widgets and pages, unknown ids, and text without references.
 */
import { describe, expect, it } from "vitest";
import type { AgDataSourcesDefinition, AgReportState } from "ag-studio";
import { readableRefs, refNames } from "@/components/insights/studio-refs";

const data = {
  sources: [{ id: "offerSales", name: "Offer sales", data: [], fields: [{ id: "title", name: "Offer" }, { id: "sold", name: "Units sold" }] }],
  expressions: [{ id: "revenue", name: "Revenue" }],
} as unknown as AgDataSourcesDefinition;
const report = { pages: [{ id: "assistant", widgets: { "units-sold": { format: { title: { text: "Units sold by product" } } } } }] } as unknown as AgReportState;
const names = refNames(data, report, { assistant: "Assistant" });

describe("readableRefs", () => {
  it("names fields, measures, widgets and pages as the owner sees them", () => {
    const text = "Configured @widget[units-sold] on @page[assistant]: @field[offerSales.title] by sum of @field[offerSales.sold], and @field[revenue].";
    expect(readableRefs(text, names)).toBe('Configured "Units sold by product" on the Assistant page: Offer by sum of Units sold, and Revenue.');
  });

  it("never leaves a raw reference for an id it does not know", () => {
    expect(readableRefs("Added @widget[new-chart] using @field[orders.paidAt]", names)).toBe('Added "new chart" using paid at');
  });

  it("leaves text without references alone", () => {
    expect(readableRefs("No changes were needed.", names)).toBe("No changes were needed.");
  });
});
