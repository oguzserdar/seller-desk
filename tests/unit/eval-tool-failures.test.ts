/** @fileoverview Recovered tool errors must remain visible in real-model evaluation evidence. */
import { expect, it } from "vitest";
import { failedToolNames } from "../../scripts/chat-eval/tool-failures";

it("retains an invalid call even when a later attempt succeeds", () => {
  const failure = { type: "tool-error", toolName: "ask_seller", error: new Error("private provider body"), input: { question: "overlong input" } };
  const recovered = { type: "tool-result", toolName: "ask_seller", output: { status: "waiting" } };
  const evidence = [...failedToolNames([failure]), ...failedToolNames([recovered])];
  expect(evidence).toEqual(["ask_seller"]);
  expect(JSON.stringify(evidence)).not.toContain("private provider body");
  expect(JSON.stringify(evidence)).not.toContain("overlong input");
});
it("does not mark ordinary tool inputs or results as SDK failures", () => {
  expect(failedToolNames([{ type: "tool-call", toolName: "my_orders" }, { type: "tool-result", toolName: "my_orders" }])).toEqual([]);
});
it("preserves multiple failures and an unnamed failed call", () => {
  expect(failedToolNames([{ type: "tool-error", toolName: "ask_seller" }, { type: "tool-error" }])).toEqual(["ask_seller", "unknown tool"]);
});
