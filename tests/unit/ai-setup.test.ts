import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiSetupKey, verifyAiSetup } from "../../src/server/ai/setup-check";
import { parseServerConfig, resetServerConfigForTests } from "../../src/server/env";
import { TEST_ENV } from "../support/test-env";
const { verify, evaluate } = vi.hoisted(() => ({ verify: vi.fn(), evaluate: vi.fn() }));
vi.mock("../../src/server/ai/registry", async (original) => ({ ...await original<typeof import("../../src/server/ai/registry")>(), verifyAssistantModel: verify }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), experimental_decide: evaluate }));
beforeEach(() => {
  verify.mockReset(); evaluate.mockReset();
  vi.stubEnv("AI_PROVIDER", "gateway"); vi.stubEnv("AI_MODEL_ID", "main"); vi.stubEnv("AI_GATEWAY_API_KEY", "secret1"); resetServerConfigForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetServerConfigForTests(); });
const pass = { ok: true, provider: "gateway", modelId: "main", latencyMs: 2 };
describe("complete AI setup proof", () => {
  it("checks main, decision and optional routine models sequentially", async () => {
    vi.stubEnv("AI_ROUTINE_MODEL_ID", "routine"); resetServerConfigForTests();
    const order: string[] = [];
    verify.mockImplementation(async (config) => { order.push(config.modelId); return pass; });
    evaluate.mockImplementation(async () => { order.push("decision"); return { answers: { check: { choice: "equal", probabilities: { equal: .99 } } } }; });
    expect(await verifyAiSetup()).toMatchObject({ ok: true }); expect(order).toEqual(["main", "decision", "routine"]);
  });
  it("does not spend on any provider when an enabled connection lacks a key", async () => {
    vi.stubEnv("AI_ROUTING_PROVIDER", "typesafe"); resetServerConfigForTests();
    expect(await verifyAiSetup()).toMatchObject({ ok: false }); expect(verify).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
  });
  it("does not mark the stack connected when decision fails or lacks probabilities", async () => {
    verify.mockResolvedValue(pass); evaluate.mockResolvedValue({ answers: { check: { choice: "equal" } } });
    expect(await verifyAiSetup()).toMatchObject({ ok: false });
    evaluate.mockRejectedValue(new Error("secret1 private response"));
    const result = await verifyAiSetup(); expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain("secret1");
  });
  it("checks the main model without a decision request when routing is off", async () => {
    vi.stubEnv("AI_ROUTING_PROVIDER", "off"); resetServerConfigForTests(); verify.mockResolvedValue(pass);
    expect(await verifyAiSetup()).toMatchObject({ ok: true }); expect(evaluate).not.toHaveBeenCalled();
  });
  it("cannot accept an unreachable routine model configuration", async () => {
    vi.stubEnv("AI_ROUTING_PROVIDER", "off"); vi.stubEnv("AI_ROUTINE_MODEL_ID", "routine"); resetServerConfigForTests();
    expect(await verifyAiSetup()).toMatchObject({ ok: false }); expect(verify).not.toHaveBeenCalled();
  });
  it("invalidates recorded proof for changed credentials, decision policy or reply models", () => {
    const base = { ...TEST_ENV, AI_PROVIDER: "gateway", AI_MODEL_ID: "main", AI_GATEWAY_API_KEY: "secret1" };
    const key = aiSetupKey(parseServerConfig(base));
    for (const change of [{ AI_GATEWAY_API_KEY: "secret2" }, { AI_MODEL_ID: "new" }, { AI_ROUTING_PROVIDER: "off" }, { AI_ROUTING_MIN_PROBABILITY: "0.99" }, { AI_ROUTINE_MODEL_ID: "routine" }]) {
      expect(aiSetupKey(parseServerConfig({ ...base, ...change }))).not.toBe(key);
    }
    expect(key).not.toContain("secret1"); expect(key).not.toBe("tool-output-v1:gateway:main");
  });
});
