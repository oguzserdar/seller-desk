/**
 * @fileoverview Unit tests for the Insights analyst's Studio adapter conversion.
 * @module tests/unit/insights-adapter
 *
 * Tests toWireTurn: tool calls join their assistant message, tool results keep their call id,
 * provided (server-side) tools are not sent, and JSON response formats pass through.
 */
import type { AgLlmRequest } from "ag-studio";
import { describe, expect, it } from "vitest";
import { toWireTurn } from "@/components/insights/studio-adapter";
import { WireTurn } from "@/components/insights/studio-wire";

const request = {
  instructions: "Be brief.",
  input: [
    { type: "message", kind: "input", role: "user", content: [{ type: "text", text: "What sold best?" }] },
    { type: "message", kind: "output", role: "assistant", status: "completed", content: [{ type: "text", text: "Checking.", annotations: [] }] },
    { type: "function_call", callId: "c1", name: "query", arguments: '{"x":1}', status: "completed" },
    { type: "function_call", callId: "c2", name: "view", arguments: "", status: "completed" },
    { type: "function_call_output", callId: "c1", output: "rows" },
  ],
  tools: [
    { name: "query", description: "Run a query", parameters: { type: "object" } },
    { name: "server_only", kind: "provided", parameters: { type: "object" } },
  ],
  toolChoice: "auto",
  responseFormat: { type: "text" },
} as unknown as AgLlmRequest;

describe("toWireTurn", () => {
  it("joins consecutive tool calls to the assistant message they came with", () => {
    const turn = toWireTurn(request);
    expect(turn.messages[1]).toEqual({
      role: "assistant",
      content: "Checking.",
      toolCalls: [
        { id: "c1", name: "query", arguments: '{"x":1}' },
        { id: "c2", name: "view", arguments: "{}" },
      ],
    });
    expect(turn.messages[2]).toEqual({ role: "tool", toolCallId: "c1", content: "rows" });
  });

  it("sends only tools the browser runs and produces a turn the server accepts", () => {
    const turn = toWireTurn(request);
    expect(turn.tools.map((tool) => tool.name)).toEqual(["query"]);
    expect(WireTurn.safeParse(turn).success).toBe(true);
  });

  it("passes a JSON response format through", () => {
    const turn = toWireTurn({ ...request, responseFormat: { type: "json", name: "plan", schema: { type: "object" } } } as AgLlmRequest);
    expect(turn.json).toEqual({ name: "plan", schema: { type: "object" } });
  });
});
