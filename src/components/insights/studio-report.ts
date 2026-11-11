/**
 * The Insights dashboard as it opens: three pages an owner reads in order. How the shop sold, how
 * much the assistant handled on its own, and how the catalog is moving. Field ids refer to
 * ./studio-data.ts.
 */
import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

/** Canvas position in tracks: 24 columns across, rows of the theme's row height. */
/** Every page: an 8px gutter round each card (16px between cards) and no canvas padding. */
const PAGE_LAYOUT = { widgetPadding: 8, pagePadding: 0, rowHeight: 18, minWidth: 300 } as const;

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
  layout: PAGE_LAYOUT,
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
      // Columns fit their content, so order numbers and statuses are never cut short.
      dataMapping: {
        cols: [{ id: "orders.ref" }, { id: "orders.product" }, { id: "revenue" }, { id: "orders.needsYou" }, { id: "orders.nextStep" }],
      },
      format: { ...titled("Paid orders and what is still owed"), style: { columnAutoSize: true } },
    },
  },
  widgetLayout: {
    summary: at(0, 0, 24, 8),
    "revenue-by-product": at(0, 8, 15, 18),
    "revenue-by-kind": at(15, 8, 9, 18),
    "order-list": at(0, 26, 24, 27),
  },
};

const assistant: AgPageState = {
  id: "assistant",
  layout: PAGE_LAYOUT,
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
  layout: PAGE_LAYOUT,
  widgets: {
    "sold-by-offer": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "offerSales.title" }], valueKey: [sum("offerSales.sold")] },
      sort: [{ field: sum("offerSales.sold"), direction: "desc" }],
      format: titled("Units sold"),
    },
    "stock-left": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "offerStock.title" }], valueKey: [sum("offerStock.inStock")] },
      sort: [{ field: sum("offerStock.inStock"), direction: "asc" }],
      format: titled("Stock left, lowest first"),
    },
    "offer-list": {
      type: "grid",
      // Columns fit their content, so order numbers and statuses are never cut short.
      dataMapping: { cols: [{ id: "offers.title" }, { id: "offers.kind" }, { id: "offers.priceLabel" }, { id: "offers.stockLabel" }, { id: "offers.sold" }] },
      format: { ...titled("Catalog"), style: { columnAutoSize: true } },
    },
  },
  widgetLayout: {
    "sold-by-offer": at(0, 0, 12, 16),
    "stock-left": at(12, 0, 12, 16),
    "offer-list": at(0, 16, 24, 26),
  },
};

/**
 * Pixel height of a page's content, from its own layout, so Studio sizes to the page and the
 * browser scrolls the page instead of Studio scrolling inside a fixed box.
 */
export function pageHeight(page: AgPageState): number {
  const rows = Math.max(...Object.values(page.widgetLayout ?? {}).map((item) => (item ? item.yTrack + item.ySpan : 0)));
  return rows * PAGE_LAYOUT.rowHeight + 24;
}

/** Below this canvas width every card takes the full width, stacked in reading order. */
export const PHONE_WIDTH = 760;

type Placement = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };

/**
 * A card's height on a phone. A full-width strip under 10 rows holds figures side by side
 * (the sales summary); on a phone they wrap into two rows, so it needs twice the height.
 */
export function phoneRows(card: Placement, columns = 24): number {
  return card.xSpan >= columns && card.ySpan < 10 ? card.ySpan * 2 : card.ySpan;
}

/**
 * Stacks cards full width in reading order (top to bottom, then left to right), keeping each
 * card's own height. Returns positions in the order the cards were given.
 */
export function stackForPhone(cards: Placement[], columns: number): Placement[] {
  const order = cards.map((card, index) => ({ card, index })).sort((a, b) => a.card.yTrack - b.card.yTrack || a.card.xTrack - b.card.xTrack);
  const placed: Placement[] = new Array(cards.length);
  let y = 0;
  for (const { card, index } of order) {
    const rows = phoneRows(card, columns);
    placed[index] = { xTrack: 0, yTrack: y, xSpan: columns, ySpan: rows };
    y += rows;
  }
  return placed;
}

/** Pixel height of a page when its cards are stacked for a phone. */
export function phonePageHeight(page: AgPageState): number {
  const rows = Object.values(page.widgetLayout ?? {}).reduce((total, item) => total + (item ? phoneRows(item) : 0), 0);
  return rows * PAGE_LAYOUT.rowHeight + 24;
}

/** Studio keeps no page names, so the dashboard's own tabs name them. */
export const INSIGHT_PAGES = [
  { id: sales.id, title: "Sales", height: pageHeight(sales), phoneHeight: phonePageHeight(sales) },
  { id: assistant.id, title: "Assistant", height: pageHeight(assistant), phoneHeight: phonePageHeight(assistant) },
  { id: catalog.id, title: "Catalog", height: pageHeight(catalog), phoneHeight: phonePageHeight(catalog) },
] as const;

/** Opens on Sales. */
export const insightsReport: AgReportState = { selectedPageId: sales.id, pages: [sales, assistant, catalog] };
