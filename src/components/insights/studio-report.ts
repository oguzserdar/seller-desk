/**
 * The Insights dashboard as it opens: three pages an owner reads in order. How the shop sold, how
 * much the assistant handled on its own, and how the catalog is moving. Field ids refer to
 * ./studio-data.ts.
 */
import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

/** Canvas position in tracks: 24 columns across, rows of the theme's row height. */
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const titled = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const average = (id: string) => ({ id, aggregation: "avg" as const });
const count = (id: string) => ({ id, aggregation: "countd" as const });

/** A number tile: bold label, large value, and a sparkline when one helps. */
const tile = (text: string, value: { id: string; aggregation?: "sum" | "avg" | "countd" }, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX ? { sparklineX: [{ id: sparklineX }] } : {}) },
  format: titled(text),
});

const sales: AgPageState = {
  id: "sales",
  widgets: {
    period: { type: "date-filter", dataMapping: { value: [{ id: "orders.date" }] }, format: { style: { filterType: "relative" } } },
    revenue: tile("Revenue through PayPal", sum("orders.amount"), "calendar::day"),
    orders: tile("Paid orders", count("orders.id"), "calendar::day"),
    average: tile("Average order", average("orders.amount")),
    "assistant-share": tile("Conversations the assistant handled", { id: "assistantShare" }),
    "revenue-by-week": {
      type: "column-chart-grouped",
      dataMapping: { categoryKey: [{ id: "calendar::week" }], valueKey: [sum("orders.amount")] },
      format: titled("Revenue by week"),
    },
    "revenue-by-kind": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "orders.kind" }], valueKey: [sum("orders.amount")] },
      format: { ...titled("Revenue by kind"), style: { custom: { pieDataLabel: { enabled: true } } } },
    },
    "revenue-by-product": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "orders.product" }], valueKey: [sum("orders.amount")] },
      sort: [{ field: sum("orders.amount"), direction: "desc" }],
      format: titled("Revenue by product"),
    },
    "order-list": {
      type: "grid",
      dataMapping: {
        cols: [{ id: "orders.ref" }, { id: "orders.product" }, sum("orders.amount"), { id: "orders.needsYou" }, { id: "orders.nextStep" }],
      },
      format: titled("Every paid order and what is still owed"),
    },
  },
  widgetLayout: {
    period: at(0, 0, 24, 4),
    revenue: at(0, 4, 6, 8),
    orders: at(6, 4, 6, 8),
    average: at(12, 4, 6, 8),
    "assistant-share": at(18, 4, 6, 8),
    "revenue-by-week": at(0, 12, 16, 18),
    "revenue-by-kind": at(16, 12, 8, 18),
    "revenue-by-product": at(0, 30, 10, 20),
    "order-list": at(10, 30, 14, 20),
  },
};

const assistant: AgPageState = {
  id: "assistant",
  widgets: {
    conversations: tile("Conversations", sum("conversations.one"), "calendar::day"),
    share: tile("Handled by the assistant alone", { id: "assistantShare" }),
    waiting: tile("Waiting for your answer", sum("conversations.waiting")),
    "who-answers": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "conversations.handledBy" }], valueKey: [sum("conversations.one")] },
      format: { ...titled("Who is answering"), style: { custom: { pieDataLabel: { enabled: true } } } },
    },
    "conversations-by-day": {
      type: "column-chart-stacked",
      dataMapping: { categoryKey: [{ id: "calendar::day" }], valueKey: [sum("conversations.byAssistant"), sum("conversations.waiting")] },
      format: { ...titled("Conversations by day: handled by the assistant, and waiting for you"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "waiting-list": {
      type: "grid",
      dataMapping: { cols: [{ id: "conversations.waitingForYou" }, { id: "conversations.handledBy" }, { id: "conversations.topic" }] },
      sort: [{ field: sum("conversations.waiting"), direction: "desc" }],
      format: titled("Latest conversations"),
    },
  },
  widgetLayout: {
    conversations: at(0, 0, 8, 8),
    share: at(8, 0, 8, 8),
    waiting: at(16, 0, 8, 8),
    "who-answers": at(0, 8, 9, 20),
    "conversations-by-day": at(9, 8, 15, 20),
    "waiting-list": at(0, 28, 24, 20),
  },
};

const catalog: AgPageState = {
  id: "catalog",
  widgets: {
    "sold-by-offer": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "offers.title" }], valueKey: [sum("offers.sold")] },
      sort: [{ field: sum("offers.sold"), direction: "desc" }],
      format: titled("Units sold by offer"),
    },
    "stock-left": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "offers.title" }], valueKey: [sum("offers.inStock")] },
      format: titled("Stock left"),
    },
    "offer-list": {
      type: "grid",
      dataMapping: { cols: [{ id: "offers.title" }, { id: "offers.kind" }, sum("offers.price"), sum("offers.inStock"), sum("offers.sold")] },
      format: titled("Catalog"),
    },
  },
  widgetLayout: {
    "sold-by-offer": at(0, 0, 12, 20),
    "stock-left": at(12, 0, 12, 20),
    "offer-list": at(0, 20, 24, 20),
  },
};

/** Studio keeps no page names, so the dashboard's own tabs name them. */
export const INSIGHT_PAGES = [
  { id: sales.id, title: "Sales" },
  { id: assistant.id, title: "Assistant" },
  { id: catalog.id, title: "Catalog" },
] as const;

/** Opens on Sales. */
export const insightsReport: AgReportState = { selectedPageId: sales.id, pages: [sales, assistant, catalog] };
