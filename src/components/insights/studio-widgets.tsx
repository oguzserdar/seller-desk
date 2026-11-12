"use client";

/**
 * Seller Desk's own AG Studio widgets. Both read through Studio's data engine (`widgetApi.getData`),
 * so page filters and cross-filters apply to them as to any built-in widget, and the owner can map
 * them to other fields in edit mode.
 */
import { useEffect, useState } from "react";
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { analystWorkWidget } from "./analyst-receipt";

type Row = Record<string, unknown>;

/** The rows for this widget's mapped fields, refreshed when filters change. */
function useMapped(params: AgWidgetParams, keys: string[], crossFilter: "filter" | "none" = "filter") {
  const mapping = params.dataMapping as unknown as Record<string, AgWidgetField[] | undefined>;
  const fields = keys.map((key) => mapping[key]?.[0]).filter((field): field is AgWidgetField => Boolean(field));
  const signature = fields.map((field) => `${field.key}:${field.aggregation ?? ""}`).join("|");
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (fields.length < keys.length) return;
    let live = true;
    const keep = (result: { replaced?: boolean; results: { rows: Row[] } }) => {
      if (live && !result.replaced) setRows(result.results.rows);
    };
    params.widgetApi
      .getData({ fields }, { queryId: "rows", crossFilter, onDataUpdated: keep })
      .then(keep)
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // The signature stands for the mapped fields, which are rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, params.widgetApi, crossFilter]);
  return { rows, fields, ready: fields.length === keys.length };
}

const field = (role: "category" | "numeric", per: string | null, aiDescription: string) => ({
  type: "field",
  supportedRoles: [role],
  requires: per ? { per, cardinality: "one" } : { cardinality: "many" },
  required: true,
  aiDescription,
});
type FormParams = { createDefaults: (options: { dataMappingItems: { key: string; label: string }[] }) => unknown };
const form = (items: [string, string][]) => (params: FormParams) =>
  params.createDefaults({ dataMappingItems: items.map(([key, label]) => ({ key, label })) });

const QUEUE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 4h11M2.5 8h11M2.5 12h7"/><circle cx="13" cy="12" r="1.5"/></svg>';
const SPLIT_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="6" width="12" height="4" rx="2"/><path d="M9 6v4"/></svg>';

/** Customers waiting for the owner, newest first, each with a way into the conversation. */
function WaitingQueue(params: AgWidgetParams) {
  const { rows, fields, ready } = useMapped(params, ["conversation", "status", "message", "since"]);
  if (!ready) return null;
  const [id, status, message, since] = fields as [AgWidgetField, AgWidgetField, AgWidgetField, AgWidgetField];
  // Newest first, by the conversation's own time, whatever order the rows arrive in.
  const waiting = (rows ?? [])
    .filter((row) => String(row[status.key]) === "Waiting for you")
    .sort((a, b) => String(b[since.key] ?? "").localeCompare(String(a[since.key] ?? "")));
  if (rows && waiting.length === 0) {
    return <p className="insights-empty">Nobody is waiting. The assistant is answering everyone it can.</p>;
  }
  return (
    <ul className="insights-queue">
      {waiting.map((row) => (
        <li key={String(row[id.key])}>
          <span className="insights-queue-dot" aria-hidden />
          <span className="insights-queue-text">{String(row[message.key] ?? "Customer conversation")}</span>
          <a className="insights-queue-open" href={`/owner/conversations?conversation=${encodeURIComponent(String(row[id.key]))}`}>
            Open
          </a>
        </li>
      ))}
    </ul>
  );
}

/** How the conversations split between the assistant alone and the owner. One tap filters the page. */
function WhoAnswered(params: AgWidgetParams) {
  // Counts the whole set: the filter this widget sets must not shrink its own bar.
  const { rows, fields, ready } = useMapped(params, ["status", "count"], "none");
  if (!ready) return null;
  const [status, count] = fields as [AgWidgetField, AgWidgetField];
  const totals = new Map((rows ?? []).map((row) => [String(row[status.key]), Number(row[count.key] ?? 0)]));
  const alone = totals.get("Answered") ?? 0;
  const needed = totals.get("Waiting for you") ?? 0;
  const all = alone + needed;
  const picked = new Set<string>();
  for (const selection of params.widgetApi.getCrossFilterSelections() ?? []) {
    if (selection.type === "value") for (const value of selection.values) picked.add(String(value));
  }
  const choose = (value: string) => params.widgetApi.toggleCrossFilter({ type: "value", field: status, value, group: 0 });
  const part = (value: string, label: string, amount: number, tone: string) => (
    <button
      type="button"
      className="insights-split-part"
      data-tone={tone}
      aria-pressed={picked.has(value)}
      style={{ flexGrow: Math.max(amount, 0.0001) }}
      onClick={() => choose(value)}
    >
      <span className="insights-split-number">{amount}</span>
      <span className="insights-split-label">{label}</span>
    </button>
  );
  return (
    <div className="insights-split">
      <div className="insights-split-bar" role="group" aria-label="Filter conversations by who answered">
        {part("Answered", "answered by the assistant", alone, "assistant")}
        {part("Waiting for you", "brought to you", needed, "owner")}
      </div>
      <p className="insights-split-note">
        {all ? `The assistant handled ${Math.round((alone / all) * 100)}% of ${all} conversations on its own.` : "No conversations yet."} Tap a side to
        filter this page.
      </p>
    </div>
  );
}

export const waitingQueueWidget = {
  id: "seller-desk-waiting",
  label: "Waiting for your answer",
  icon: QUEUE_ICON,
  dataMapping: {
    conversation: field("category", null, "The conversation id, used to open it."),
    status: field("category", null, "Whether the customer is waiting for the owner."),
    message: field("category", null, "The latest message, shown as the row's text."),
    since: field("category", null, "When the conversation last changed; the newest is listed first."),
  },
  form: form([["conversation", "Conversation"], ["status", "Waiting"], ["message", "Latest message"], ["since", "Last message"]]),
  comp: WaitingQueue,
  defaultSize: { width: 640, height: 280 },
  minSize: { width: 320, height: 160 },
  ai: { description: "The customers waiting for the shop owner's answer, each with an Open link into that conversation on the desk." },
} as unknown as AgWidgetDefinition;

export const whoAnsweredWidget = {
  id: "seller-desk-who-answered",
  label: "Who answered",
  icon: SPLIT_ICON,
  dataMapping: {
    status: field("category", null, "Answered by the assistant, or waiting for the owner."),
    count: field("numeric", "dataMapping.status", "Number of conversations, summed."),
  },
  form: form([["status", "Status"], ["count", "Conversations"]]),
  comp: WhoAnswered,
  defaultSize: { width: 640, height: 200 },
  minSize: { width: 320, height: 140 },
  ai: { description: "A split bar: conversations the assistant answered alone versus those it brought to the owner. Tapping a side cross-filters the page." },
} as unknown as AgWidgetDefinition;


const SUMMARY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 10V8M8 10V6M11 10V7"/></svg>';

/** The shop's money in one strip: what PayPal confirmed, how many orders, and what is still owed. */
function SalesSummary(params: AgWidgetParams) {
  const { rows, fields, ready } = useMapped(params, ["status", "revenue", "orders"]);
  if (!ready) return null;
  const [status, revenue, orders] = fields as [AgWidgetField, AgWidgetField, AgWidgetField];
  const list = rows ?? [];
  const total = list.reduce((sum, row) => sum + Number(row[revenue.key] ?? 0), 0);
  const count = list.reduce((sum, row) => sum + Number(row[orders.key] ?? 0), 0);
  const owed = list.filter((row) => String(row[status.key]) === "Needs you").reduce((sum, row) => sum + Number(row[orders.key] ?? 0), 0);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const figures = [
    { label: "Revenue through PayPal", value: money.format(total), lead: true },
    { label: "Paid orders", value: String(count) },
    { label: "Average order", value: count ? money.format(total / count) : "None yet" },
    { label: "Work still owed", value: String(owed), attention: owed > 0 },
  ];
  return (
    <div className="insights-summary">
      <dl className="insights-summary-figures">
        {figures.map((figure) => (
          <div key={figure.label} data-lead={figure.lead ? "" : undefined} data-attention={figure.attention ? "" : undefined}>
            <dt>{figure.label}</dt>
            <dd>{figure.value}</dd>
          </div>
        ))}
      </dl>
      <p className="insights-summary-rule">Every amount here is a payment PayPal confirmed. The assistant never sets a price or marks an order paid.</p>
    </div>
  );
}

export const salesSummaryWidget = {
  id: "seller-desk-summary",
  label: "Sales summary",
  icon: SUMMARY_ICON,
  dataMapping: {
    status: field("category", null, "Whether an order still owes work: Needs you or Done."),
    revenue: field("numeric", "dataMapping.status", "Revenue, summed."),
    orders: field("numeric", "dataMapping.status", "Number of orders, counted."),
  },
  form: form([["status", "Status"], ["revenue", "Revenue"], ["orders", "Orders"]]),
  comp: SalesSummary,
  defaultSize: { width: 1000, height: 150 },
  minSize: { width: 360, height: 120 },
  ai: { description: "The shop's paid revenue, order count, average order and orders still owing work, from PayPal-confirmed payments only." },
} as unknown as AgWidgetDefinition;

export const SELLER_DESK_WIDGETS = [salesSummaryWidget, waitingQueueWidget, whoAnsweredWidget, analystWorkWidget];
