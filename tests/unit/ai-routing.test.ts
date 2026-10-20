import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerConfig, parseServerConfig, resetServerConfigForTests } from "../../src/server/env";
import { decideHandling, resetRoutingAccessForTests, routeAssistantTurn } from "../../src/server/ai/routing";
import { canUseRoutineModel, handlingQuestion, routingState } from "../../src/server/ai/routing-policy";
import { TEST_ENV } from "../support/test-env";

const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), experimental_decide: evaluate }));
const state = routingState("buyer", [{ id: "u", role: "user", parts: [{ type: "text", text: "What are you?" }] }], "");
const result = (choice = "routine", probability: number | null = 0.99) => ({ answers: { route: { choice, probabilities: probability === null ? undefined : { [choice]: probability } } }, response: { modelId: "jev-resolved" }, usage: { inputTokens: 80 } });
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gateway"); vi.stubEnv("AI_MODEL_ID", "anthropic/claude-sonnet-5.5"); vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
  evaluate.mockReset(); resetServerConfigForTests(); resetRoutingAccessForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetServerConfigForTests(); });

describe("a router the account cannot use", () => {
  const refused = () => Object.assign(new Error("Free tier users do not have access to this model."), { statusCode: 403 });
  it("stops calling the router after the provider refuses access, instead of paying the delay every turn", async () => {
    evaluate.mockRejectedValue(refused());
    expect((await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" })).trace.status).toBe("failed");
    const second = await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(second).toMatchObject({ tier: "main", trace: { status: "unavailable", latencyMs: 0 } });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it("keeps trying after an ordinary failure such as a timeout", async () => {
    evaluate.mockRejectedValue(Object.assign(new Error("timeout"), { statusCode: 504 }));
    await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});

describe("advisory decisions, never payment authority", () => {
  it("does not enable Haiku or any routine model implicitly", async () => {
    evaluate.mockResolvedValue(result());
    const selected = await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(selected.tier).toBe("main"); expect(selected.modelId).toBe("anthropic/claude-sonnet-5.5");
    expect(getServerConfig().routineAi).toBeNull();
  });
  it("uses an explicitly chosen routine model only for a high-probability routine decision", async () => {
    vi.stubEnv("AI_ROUTINE_PROVIDER", "openai"); vi.stubEnv("AI_ROUTINE_MODEL_ID", "chosen-small-model"); vi.stubEnv("OPENAI_API_KEY", "only-routine-key"); resetServerConfigForTests();
    evaluate.mockResolvedValue(result());
    const selected = await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(selected).toMatchObject({ tier: "routine", provider: "openai", modelId: "chosen-small-model" });
    expect(evaluate.mock.calls[0]![0]).toMatchObject({ maxRetries: 0 });
  });
  for (const [route, probability] of [["recovery", .99], ["complex", .99], ["seller", .99], ["routine", .94], ["routine", null]] as const) {
    it(`keeps ${route}/${probability} on the main model`, async () => {
      vi.stubEnv("AI_ROUTINE_MODEL_ID", "cheap-model"); resetServerConfigForTests(); evaluate.mockResolvedValue(result(route, probability));
      expect((await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" })).tier).toBe("main");
    });
  }
  it("keeps seller-answer continuations on the main model", async () => {
    vi.stubEnv("AI_ROUTINE_MODEL_ID", "cheap-model"); resetServerConfigForTests(); evaluate.mockResolvedValue(result());
    expect((await routeAssistantTurn({ role: "buyer", messages: [], currentState: "", forceMain: true })).tier).toBe("main");
  });
  it("returns no synthetic answer or unsafe error body after a decision failure", async () => {
    evaluate.mockRejectedValue(new Error("echoed-secret"));
    const selected = await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(selected).toMatchObject({ tier: "main", trace: { status: "failed" }, guidance: "" });
    expect(JSON.stringify(selected.trace)).not.toContain("echoed-secret");
    expect(selected).not.toHaveProperty("text");
  });
  it("does not call a provider when already cancelled", async () => {
    const signal = AbortSignal.abort();
    await expect(decideHandling(getServerConfig().routing, state, signal)).rejects.toBeDefined();
    expect(evaluate).not.toHaveBeenCalled();
  });
  it("propagates mid-flight cancellation instead of starting a fallback answer", async () => {
    const controller = new AbortController();
    evaluate.mockImplementation(async () => { controller.abort(); throw new Error("cancelled"); });
    await expect(routeAssistantTurn({ role: "buyer", messages: [], currentState: "", signal: controller.signal })).rejects.toBeDefined();
  });
  it("rejects malformed choices and invalid probabilities", async () => {
    for (const invalid of [result("approve_payment", 1), result("routine", 2), result("routine", NaN)]) {
      evaluate.mockResolvedValue(invalid);
      expect((await decideHandling(getServerConfig().routing, state)).status).toBe("failed");
    }
    expect(canUseRoutineModel("routine", NaN, .95, false)).toBe(false);
  });
  it("preserves existing native installations with routing off and reads only selected keys", () => {
    const native = parseServerConfig({ ...TEST_ENV, AI_PROVIDER: "openai", AI_MODEL_ID: "chosen", OPENAI_API_KEY: "native" });
    expect(native.routing.status).toBe("off");
    const mixed = parseServerConfig({ ...TEST_ENV, AI_PROVIDER: "anthropic", AI_MODEL_ID: "chosen", ANTHROPIC_API_KEY: "reply", AI_ROUTING_PROVIDER: "typesafe", TYPESAFE_AI_API_KEY: "decision" });
    expect(mixed.routing).toMatchObject({ status: "ready", apiKey: "decision", modelId: "jev-1.13.0" });
    expect(mixed.ai).toMatchObject({ apiKey: "reply" });
    expect(mixed.routineAi).toBeNull();
  });
  it("reports incomplete routine settings instead of silently inheriting the main model", () => {
    expect(parseServerConfig({ ...TEST_ENV, AI_PROVIDER: "gateway", AI_MODEL_ID: "main", AI_GATEWAY_API_KEY: "key", AI_ROUTINE_PROVIDER: "openai", OPENAI_API_KEY: "key2" }).routineAi?.status).toBe("unavailable");
  });
  it("bounds decision context and excludes hidden reasoning and tool results", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: String(i), role: "user" as const, parts: [{ type: "text" as const, text: "x".repeat(5000) }, { type: "reasoning" as const, text: "private-reasoning" }] }));
    const bounded = routingState("owner", messages, "y".repeat(8000));
    expect(bounded.priorMessages).toHaveLength(4); expect(bounded.currentMessage?.text.length).toBe(4000); expect(bounded.serverContext.length).toBe(4000);
    expect(JSON.stringify(bounded)).not.toContain("private-reasoning");
    expect(handlingQuestion("owner").route.criteria.seller).toContain("external");
  });
  it("bounds the extra delay when the decision provider stalls", async () => {
    evaluate.mockImplementation(({ abortSignal }) => new Promise((_, reject) => {
      abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
    }));
    const started = Date.now();
    expect((await decideHandling(getServerConfig().routing, state)).status).toBe("failed");
    expect(Date.now() - started).toBeLessThan(4000);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
