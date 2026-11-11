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
    summary: {
      type: "seller-desk-summary",
      dataMapping: { status: [{ id: "orders.needsYou" }], revenue: [sum("orders.amount")], orders: [count("orders.id")] },
      format: { title: { enabled: false } },
    } as never,
    "revenue-by-product": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "orders.product" }], valueKey: [sum("orders.amount")] },
      sort: [{ field: sum("orders.amount"), direction: "desc" }],
      format: titled("Revenue by product"),
    },
    "revenue-by-kind": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "orders.kind" }], valueKey: [sum("orders.amount")] },
      format: { ...titled("Revenue by kind"), style: { custom: { pieDataLabel: { enabled: false } } } },
    },
    "order-list": {
      type: "grid",
      dataMapping: {
        cols: [{ id: "orders.ref" }, { id: "orders.product" }, { id: "orders.kind" }, sum("orders.amount"), { id: "orders.needsYou" }, { id: "orders.nextStep" }],
      },
      format: titled("Paid orders and what is still owed"),
    },
  },
  widgetLayout: {
    summary: at(0, 0, 24, 8),
    "revenue-by-product": at(0, 8, 15, 18),
    "revenue-by-kind": at(15, 8, 9, 18),
    "order-list": at(0, 26, 24, 22),
  },
};

const assistant: AgPageState = {
  id: "assistant",
  widgets: {
    conversations: tile("Conversations", sum("conversations.one")),
    share: tile("Answered by the assistant", { id: "assistantShare" }),
    waiting: tile("Waiting for your answer", sum("conversations.waiting")),
    // Seller Desk's own widgets (./studio-widgets.tsx); Studio's types list only its built-in ones.
    "who-answers": {
      type: "seller-desk-who-answered",
      dataMapping: { status: [{ id: "conversations.waitingForYou" }], count: [sum("conversations.one")] },
      format: titled("Who answered"),
    } as never,
    "conversations-by-day": {
      type: "column-chart-stacked",
      dataMapping: { categoryKey: [{ id: "calendar::day" }], valueKey: [sum("conversations.byAssistant"), sum("conversations.waiting")] },
      format: { ...titled("Conversations by day"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "waiting-list": {
      type: "seller-desk-waiting",
      dataMapping: {
        conversation: [{ id: "conversations.id" }],
        status: [{ id: "conversations.waitingForYou" }],
        message: [{ id: "conversations.topic" }],
      },
      format: titled("Waiting for your answer"),
    } as never,
  },
  widgetLayout: {
    conversations: at(0, 0, 8, 8),
    share: at(8, 0, 8, 8),
    waiting: at(16, 0, 8, 8),
    "who-answers": at(0, 8, 24, 10),
    "waiting-list": at(0, 18, 12, 22),
    "conversations-by-day": at(12, 18, 12, 22),
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
