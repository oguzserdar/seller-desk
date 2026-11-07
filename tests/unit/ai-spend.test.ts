/**
 * The daily AI budget's arithmetic: model prices as providers and gateways name
 * models, the operator's price override, cost in micro-dollars, and metering of
 * both generated and streamed calls.
 */
import { describe, expect, it } from "vitest";
import { generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { costMicros, meterModel, parsePrice, priceFor } from "@/server/ai/spend";

const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 500, text: 500, reasoning: 0 } };
const finish = { unified: "stop" as const, raw: "stop" };

describe("prices", () => {
  it("finds a model however the provider or gateway writes its id", () => {
    const sonnet = { input: 2, output: 10 };
    expect(priceFor("claude-sonnet-5-5")).toEqual(sonnet);
    expect(priceFor("anthropic/claude-sonnet-5.5")).toEqual(sonnet);
    expect(priceFor("openrouter/anthropic/claude-sonnet-5.5")).toEqual(sonnet);
  });

  it("has no price for an unlisted model unless the operator gives one", () => {
    expect(priceFor("some-new-model")).toBeNull();
    expect(priceFor("some-new-model", parsePrice("0.5, 1.5"))).toEqual({ input: 0.5, output: 1.5 });
  });

  it("refuses a malformed price override", () => {
    for (const value of [undefined, "", "2", "2,10,3", "two,ten", "-1,2"]) expect(parsePrice(value)).toBeNull();
  });

  it("prices tokens in micro-dollars", () => {
    // 1,000 input tokens at $2 per million plus 500 output tokens at $10 per million is $0.007.
    expect(costMicros({ input: 2, output: 10 }, 1000, 500)).toBe(7000);
  });
});

describe("metering", () => {
  it("records the cost of a generated call", async () => {
    const spent: number[] = [];
    const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: "Hi" }], finishReason: finish, usage, warnings: [] }) });
    await generateText({ model: meterModel(model, { input: 2, output: 10 }, async (micros) => { spent.push(micros); }), prompt: "Hello" });
    expect(spent).toEqual([7000]);
  });

  it("records the cost of a streamed call when it finishes", async () => {
    const spent: number[] = [];
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "t" });
            controller.enqueue({ type: "text-delta", id: "t", delta: "Hi" });
            controller.enqueue({ type: "text-end", id: "t" });
            controller.enqueue({ type: "finish", finishReason: finish, usage });
            controller.close();
          },
        }),
      }),
    });
    const result = streamText({ model: meterModel(model, { input: 2, output: 10 }, async (micros) => { spent.push(micros); }), prompt: "Hello" });
    expect(await result.text).toBe("Hi");
    expect(spent).toEqual([7000]);
  });

  it("still answers when the spend cannot be recorded", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: "Hi" }], finishReason: finish, usage, warnings: [] }) });
    const metered = meterModel(model, { input: 2, output: 10 }, async () => { throw new Error("database unavailable"); });
    expect((await generateText({ model: metered, prompt: "Hello" })).text).toBe("Hi");
  });
});
