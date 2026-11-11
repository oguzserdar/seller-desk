// @vitest-environment happy-dom
/**
 * @fileoverview Unit tests for the Insights grid cells.
 * @module tests/unit/studio-cells
 *
 * Long names carry their full text for hover; aggregated columns keep the grid's own cell.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgWidgetField } from "ag-studio";
import { createCellRenderer } from "@/components/insights/studio-cells";

const field = (fieldId: string, aggregation?: string) => ({ fieldId, aggregation }) as unknown as AgWidgetField;

describe("createCellRenderer", () => {
  it("shows an offer's full name on hover", () => {
    const Cell = createCellRenderer(field("offers.title"))!;
    const html = renderToStaticMarkup(createElement(Cell, { value: "Restored leather saddle, one of a kind", node: {} } as never));
    expect(html).toContain('title="Restored leather saddle, one of a kind"');
  });

  it("leaves aggregated columns to the grid", () => {
    expect(createCellRenderer(field("offers.title", "count"))).toBeUndefined();
  });
});
