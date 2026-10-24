/**
 * @fileoverview The handling decision through the SDK's real experimental_decide, with a fake decision
 * model in place of a provider. Mocking decide itself would hide the SDK's own checks on what a
 * provider returns, such as its rejection of an incomplete probability distribution.
 */
import type { Experimental_DecisionModelV4, Experimental_DecisionModelV4Answer } from "@ai-sdk/provider";
import { afterEach, expect, it } from "vitest";
import { DECISION_FACTORIES, decideHandling, resetRoutingAccessForTests } from "@/server/ai/routing";
import { routingState } from "@/server/ai/routing-policy";

const original = DECISION_FACTORIES.openai;
afterEach(() => { DECISION_FACTORIES.openai = original; resetRoutingAccessForTests(); });

function answering(answer: Experimental_DecisionModelV4Answer) {
  const model: Experimental_DecisionModelV4 = {
    specificationVersion: "v4", provider: "test", modelId: "test-decider", supportedQuestionTypes: ["choice"],
    doDecide: async () => ({ answers: { route: answer }, warnings: [] }),
  };
  DECISION_FACTORIES.openai = () => model as never;
}

const config = { status: "ready" as const, provider: "openai" as const, modelId: "test-decider", apiKey: "k", minProbability: 0.9 };
const state = routingState("buyer", [{ id: "1", role: "user", parts: [{ type: "text", text: "Do you have brake pads?" }] }], "Shop: Spoke Street Cycles");

it("accepts a confident routine decision with a complete distribution", async () => {
  answering({ type: "choice", choice: "routine", probabilities: { routine: 0.95, recovery: 0.02, complex: 0.02, seller: 0.01 } });
  expect(await decideHandling(config, state)).toMatchObject({ status: "accepted", route: "routine", probability: 0.95 });
});

it("treats a confident-looking choice below the threshold as uncertain", async () => {
  answering({ type: "choice", choice: "routine", probabilities: { routine: 0.6, recovery: 0.1, complex: 0.2, seller: 0.1 } });
  expect(await decideHandling(config, state)).toMatchObject({ status: "uncertain", route: "routine" });
});

it("falls back to the main model when a provider returns only part of the distribution", async () => {
  answering({ type: "choice", choice: "routine", probabilities: { routine: 0.99 } });
  expect(await decideHandling(config, state)).toMatchObject({ status: "failed", route: null });
});
