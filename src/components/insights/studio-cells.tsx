"use client";

/**
 * Cells for the Insights grids, through the grid widget's `createCellRenderer` option: order status
 * as a pill, order numbers as links into the desk, and stock that is running low flagged.
 */
import type { AgWidgetField } from "ag-studio";
import type { AgWidgetCustomCellRendererProps } from "ag-studio-react";
import type { ComponentType } from "react";

type Props = AgWidgetCustomCellRendererProps;
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
/** The totals row keeps the grid's own text ("Total", or nothing), never a pill or a link. */
const isTotals = (props: Props) => Boolean(props.node?.rowPinned || props.node?.footer);
const plain = (props: Props) => (isTotals(props) ? <span>{text(props.valueFormatted ?? props.value)}</span> : null);

function StatusCell(props: Props) {
  const status = text(props.value);
  if (isTotals(props) || !status) return plain(props);
  return <span className="insights-pill" data-tone={status === "Needs you" ? "attention" : "done"}>{status}</span>;
}

function OrderCell(props: Props) {
  const { value } = props;
  // Every order has a number; the only row without one is the totals row, which this column heads.
  if (isTotals(props) || !text(value)) return <strong>Total</strong>;
  return (
    <a className="insights-cell-link" href="/owner/orders" title="Open the desk">
      {text(value)}
    </a>
  );
}

function StockCell(props: Props) {
  const stock = text(props.value);
  if (isTotals(props) || !stock) return plain(props);
  const left = Number(stock);
  if (stock === "Not stocked") return <span className="insights-cell-muted">Not stocked</span>;
  return Number.isFinite(left) && left <= 2 ? <span className="insights-pill" data-tone="attention">{left} left</span> : <span>{stock}</span>;
}

/** A long name keeps the grid's ellipsis and shows in full on hover, as spreadsheets do. */
function NameCell(props: Props) {
  const name = text(props.valueFormatted ?? props.value);
  if (isTotals(props) || !name) return plain(props);
  return <span className="insights-cell-name" title={name}>{name}</span>;
}

const BY_FIELD: Record<string, ComponentType<Props>> = {
  "offers.title": NameCell,
  "orders.product": NameCell,
  "orders.needsYou": StatusCell,
  "orders.ref": OrderCell,
  "offers.stockLabel": StockCell,
};

/** Picks a renderer for a grid column; aggregated columns stay plain numbers. */
export function createCellRenderer(field: AgWidgetField): ComponentType<Props> | undefined {
  if (field.aggregation) return undefined;
  return BY_FIELD[String(field.fieldId)];
}
