import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { judgeOutcome } from "@/server/simulation/judge";

const side = {
  transcript: [
    { role: "user" as const, text: "Add the brake service please" },
    { role: "assistant" as const, text: "I've added one brake service to your quote. It is ready to pay." },
  ],
  records: { quotes: 1, paidOrders: 0, captures: 0, pendingTasks: 0, completedTasks: 0, openSellerQuestions: 0 },
};
const grader = (verdict: object) => new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: "text", text: JSON.stringify(verdict) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
    warnings: [],
  }),
});

describe("shop test grader", () => {
  it("passes when the verdict is met and its quotes are in the conversation", async () => {
    const check = await judgeOutcome(grader({ met: true, reason: "The service was quoted and payable.", evidence: ["It is ready to pay."] }), "The brake service is quoted and ready to pay.", side);
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("It is ready to pay.");
  });
  it("does not trust a verdict that quotes text the conversation never contained", async () => {
    const check = await judgeOutcome(grader({ met: true, reason: "Paid.", evidence: ["Your payment went through."] }), "The order is paid.", side);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("not in the conversation");
  });
  it("fails closed when the grader cannot answer", async () => {
    const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("provider down"); } });
    expect((await judgeOutcome(broken, "Anything.", side)).passed).toBe(false);
  });
});
