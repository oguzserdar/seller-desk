// @vitest-environment happy-dom
/**
 * @fileoverview Unit tests for the Insights analyst's receipt and conversation history.
 * @module tests/unit/analyst-receipt
 *
 * The receipt counts questions people asked (not delegated sub-runs), figures read, dashboard
 * changes, hand-offs and tokens; the history store saves, replaces and deletes conversations.
 */
import type { AgAiTelemetryEvent, AgAiThread } from "ag-studio";
import { afterEach, describe, expect, it } from "vitest";
import { addEvent, toolKind, type Receipt } from "@/components/insights/analyst-receipt";
import { browserHistory } from "@/components/insights/analyst-history";

const zero: Receipt = { questions: 0, lookups: 0, changes: 0, handoffs: 0, failed: 0, tokens: 0 };
const trace = (parentRunId?: string) => ({ threadId: "t", runId: "r", agentId: "a", ...(parentRunId ? { parentRunId } : {}) });
const event = (value: object) => ({ timestamp: 0, trace: trace(), ...value }) as AgAiTelemetryEvent;

describe("analyst receipt", () => {
  it("sorts tools by what they do", () => {
    expect(toolKind("restock_watch")).toBe("lookup");
    expect(toolKind("execute_query")).toBe("lookup");
    expect(toolKind("add_widget")).toBe("change");
    expect(toolKind("configure_widget")).toBe("change");
    expect(toolKind("delegate_to")).toBe("handoff");
    expect(toolKind("rename_thread")).toBe("other");
  });

  it("counts a question once, not again for each delegated sub-run", () => {
    let receipt = addEvent(zero, event({ type: "run_started", query: "q", toolSchemas: [] }));
    receipt = addEvent(receipt, { ...event({ type: "run_started", query: "sub", toolSchemas: [] }), trace: trace("r") } as AgAiTelemetryEvent);
    expect(receipt.questions).toBe(1);
  });

  it("adds figures read, dashboard changes, failures and tokens", () => {
    const steps = [
      event({ type: "tool_execution_finished", toolCallId: "1", name: "top_sellers", kind: "client", ok: true }),
      event({ type: "tool_execution_finished", toolCallId: "2", name: "add_widget", kind: "client", ok: true }),
      event({ type: "tool_execution_finished", toolCallId: "3", name: "execute_query", kind: "client", ok: false }),
      event({ type: "turn_finished", usage: { inputTokens: 900, outputTokens: 100 } }),
    ];
    expect(steps.reduce(addEvent, zero)).toEqual({ questions: 0, lookups: 1, changes: 1, handoffs: 0, failed: 1, tokens: 1000 });
  });
});

describe("browser history", () => {
  afterEach(() => window.localStorage.clear());
  const thread = (threadId: string, title = "") => ({ summary: { threadId, agentId: "a", title }, messages: [] }) as unknown as AgAiThread;

  it("saves, replaces and deletes conversations, keeping owner and visitor apart", async () => {
    const owner = browserHistory("seller-desk.analyst.owner");
    await owner.saveThread(thread("one", "first"));
    await owner.saveThread(thread("two"));
    await owner.saveThread(thread("one", "renamed"));
    expect((await owner.listThreads()).map((summary) => summary.threadId)).toEqual(["two", "one"]);
    expect((await owner.loadThread("one"))?.summary).toMatchObject({ title: "renamed" });
    await owner.deleteThread("two");
    expect((await owner.listThreads()).map((summary) => summary.threadId)).toEqual(["one"]);
    expect(await browserHistory("seller-desk.analyst.visitor").listThreads()).toEqual([]);
  });
});
