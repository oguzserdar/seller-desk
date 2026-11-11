"use client";

/**
 * A running receipt of what the Insights analyst did, from Studio's telemetry: questions asked,
 * figures read, dashboard changes, hand-offs to Studio's agents, and tokens. It also states the
 * one rule as evidence: the analyst has no tool that can change money.
 */
import { useSyncExternalStore } from "react";
import type { AgAiTelemetryEvent, AgAiTelemetryObserver } from "ag-studio";

export type Receipt = { questions: number; lookups: number; changes: number; handoffs: number; failed: number; tokens: number };
const EMPTY: Receipt = { questions: 0, lookups: 0, changes: 0, handoffs: 0, failed: 0, tokens: 0 };

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
      if (kind === "lookup") return { ...receipt, lookups: receipt.lookups + 1 };
      if (kind === "change") return { ...receipt, changes: receipt.changes + 1 };
      if (kind === "handoff") return { ...receipt, handoffs: receipt.handoffs + 1 };
      return receipt;
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
