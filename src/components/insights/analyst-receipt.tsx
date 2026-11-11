"use client";

/**
 * A running receipt of what the Insights analyst did, from Studio's telemetry: questions asked,
 * figures read, dashboard changes, hand-offs to Studio's agents, and tokens. It also states the
 * one rule as evidence: the analyst has no tool that can change money.
 */
import { useSyncExternalStore } from "react";
import type { AgAiTelemetryEvent, AgAiTelemetryObserver, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";

/** Counts for this visit, plus the last few steps in plain words, newest last. */
export type Step = { text: string; kind: "lookup" | "change" | "handoff" };
export type Receipt = { questions: number; lookups: number; changes: number; handoffs: number; failed: number; tokens: number; steps: Step[] };
const EMPTY: Receipt = { questions: 0, lookups: 0, changes: 0, handoffs: 0, failed: 0, tokens: 0, steps: [] };
const STEP_LIMIT = 4;

// Seller Desk's tools and Studio's own, in the words an owner would use.
const STEP_WORDS: Record<string, string> = {
  shop_pulse: "Read the shop pulse",
  customers_waiting: "Read who is waiting",
  restock_watch: "Checked stock",
  top_sellers: "Ranked top sellers",
  delegate_to: "Handed off to a Studio agent",
  view_plan: "Read the plan",
  view_schema: "Read the data model",
  view_report: "Read the dashboard",
  view_widget: "Checked a chart",
  view_page: "Read a page",
  execute_query: "Ran a query",
  add_widget: "Added a chart",
  configure_widget: "Set up a chart",
  remove_widget: "Removed a chart",
  position_widget: "Moved a chart",
  update_widget: "Changed a chart",
  add_page: "Added a page",
};

/** One finished tool call as a short sentence: our own names, else Studio's tool name in words. */
export function stepText(name: string): string {
  const words = STEP_WORDS[name] ?? name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Sorts one tool by what it does to the shop's data or the dashboard. */
export function toolKind(name: string): "lookup" | "change" | "handoff" | "other" {
  if (/delegate/.test(name)) return "handoff";
  if (/^(add|remove|position|configure|update|create|delete|set|clear|rename)_/.test(name) && !/thread/.test(name)) return "change";
  if (/^(view|execute|read|shop_pulse|customers_waiting|restock_watch|top_sellers)/.test(name)) return "lookup";
  return "other";
}

/** Adds one telemetry event to a receipt. Questions count only conversations a person started. */
export function addEvent(receipt: Receipt, event: AgAiTelemetryEvent): Receipt {
  switch (event.type) {
    case "run_started":
      return event.trace.parentRunId ? receipt : { ...receipt, questions: receipt.questions + 1 };
    case "turn_finished":
      return { ...receipt, tokens: receipt.tokens + (event.usage ? event.usage.inputTokens + event.usage.outputTokens : 0) };
    case "tool_execution_finished": {
      if (!event.ok) return { ...receipt, failed: receipt.failed + 1 };
      const kind = toolKind(event.name);
      if (kind === "other") return receipt;
      const steps = [...receipt.steps, { text: stepText(event.name), kind }].slice(-STEP_LIMIT);
      if (kind === "lookup") return { ...receipt, lookups: receipt.lookups + 1, steps };
      if (kind === "change") return { ...receipt, changes: receipt.changes + 1, steps };
      return { ...receipt, handoffs: receipt.handoffs + 1, steps };
    }
    default:
      return receipt;
  }
}

/** One receipt per page visit, fed by Studio's observer and read by React. */
export function createReceipt() {
  let current = EMPTY;
  const listeners = new Set<() => void>();
  const observer: AgAiTelemetryObserver = {
    onEvent(event) {
      const next = addEvent(current, event);
      if (next !== current) {
        current = next;
        for (const listener of listeners) listener();
      }
    },
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { observer, subscribe, read: () => current };
}

type ReceiptSource = ReturnType<typeof createReceipt>;

/** This visit's receipt: the strip above the dashboard and the widget on the canvas read the same one. */
export const visitReceipt = createReceipt();

/** The receipt strip shown above the dashboard once the analyst has done anything. */
export function AnalystReceipt({ source }: { source: ReceiptSource }) {
  const receipt = useSyncExternalStore(source.subscribe, source.read, () => EMPTY);
  if (!receipt.questions) return null;
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const items = [
    plural(receipt.questions, "question", "questions"),
    plural(receipt.lookups, "figure read", "figures read"),
    plural(receipt.changes, "dashboard change", "dashboard changes"),
    plural(receipt.handoffs, "hand-off to Studio's agents", "hand-offs to Studio's agents"),
  ];
  return (
    <div className="insights-receipt" role="status" aria-live="polite">
      <span className="insights-receipt-title">What the analyst did</span>
      <span className="insights-receipt-items">{items.join(" · ")}</span>
      <span className="insights-receipt-money">Money changed: none. It has no tool that can.</span>
      {receipt.tokens ? <span className="insights-receipt-tokens">{(receipt.tokens / 1000).toFixed(1)}k tokens</span> : null}
    </div>
  );
}

const WORK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 2.5h8v11H4z"/><path d="M6 6h4M6 8.5h4M6 11h2"/></svg>';

/** The analyst's own work as a card on the canvas, laid out like the sales summary beside it. */
function AnalystWork(_params: AgWidgetParams) {
  const receipt = useSyncExternalStore(visitReceipt.subscribe, visitReceipt.read, () => EMPTY);
  const figures = [
    ["Questions asked", receipt.questions],
    ["Figures read", receipt.lookups],
    ["Dashboard changes", receipt.changes],
    ["Hand-offs to Studio", receipt.handoffs],
  ] as const;
  return (
    <div className="insights-work">
      <dl className="insights-work-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="insights-work-steps">
        <span className="insights-work-steps-title">Latest steps</span>
        {receipt.steps.length ? (
          <ol>
            {receipt.steps.map((step, index) => (
              <li key={index} data-kind={step.kind}>
                {step.text}
              </li>
            ))}
          </ol>
        ) : (
          <span className="insights-work-none">None yet this visit. Ask the analyst a question and its steps appear here.</span>
        )}
      </div>
      <p className="insights-work-money">
        <strong>Money changed: none.</strong> The analyst can read figures and arrange this dashboard. It has no tool that touches a price, an order or a payment.
      </p>
    </div>
  );
}

export const analystWorkWidget = {
  id: "seller-desk-analyst-work",
  label: "What the analyst did",
  icon: WORK_ICON,
  dataMapping: {},
  form: (params: { createDefaults: (options: { dataMappingItems: unknown[] }) => unknown }) => params.createDefaults({ dataMappingItems: [] }),
  comp: AnalystWork,
  defaultSize: { width: 1000, height: 200 },
  minSize: { width: 320, height: 180 },
  ai: { description: "A live record of this visit's analyst work: questions, figures read, dashboard changes, hand-offs and the latest steps. It reads no shop data." },
} as unknown as AgWidgetDefinition;
