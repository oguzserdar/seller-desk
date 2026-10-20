/** @fileoverview Optional native decisions: configuration, advisory classification and setup checks. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseServerConfig, resetServerConfigForTests } from "../../src/server/env";
import { routeAssistantTurn, resetRoutingAccessForTests } from "../../src/server/ai/routing";
import { verifyAiSetup } from "../../src/server/ai/setup-check";
import { TEST_ENV } from "../support/test-env";

const { decide, verify } = vi.hoisted(() => ({ decide: vi.fn(), verify: vi.fn() }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), experimental_decide: decide }));
vi.mock("../../src/server/ai/registry", async (original) => ({ ...await original<typeof import("../../src/server/ai/registry")>(), verifyAssistantModel: verify }));
const base = { ...TEST_ENV, AI_PROVIDER: "anthropic", AI_MODEL_ID: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "test-only-claude" };

beforeEach(() => {
  for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
  vi.stubEnv("AI_ROUTING_PROVIDER", "anthropic");
  resetServerConfigForTests(); resetRoutingAccessForTests(); decide.mockReset(); verify.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); resetServerConfigForTests(); });

describe("optional native decision providers", () => {
  it("does not enable Haiku when only the reply model is configured", () => {
    expect(parseServerConfig(base).routing).toEqual({ status: "off" });
  });
  it("uses the Claude credential for explicitly selected Haiku classification", () => {
    expect(parseServerConfig({ ...base, AI_ROUTING_PROVIDER: "anthropic" }).routing).toMatchObject({
      status: "ready", provider: "anthropic", modelId: "claude-haiku-5-5", apiKey: "test-only-claude",
    });
  });
  it("uses a separate selected OpenAI key and the Decisions endpoint model", () => {
    const config = parseServerConfig({ ...base, AI_ROUTING_PROVIDER: "openai", OPENAI_API_KEY: "test-only-openai" });
    expect(config.routing).toMatchObject({ status: "ready", provider: "openai", modelId: "gpt-6-luna", apiKey: "test-only-openai" });
    expect(config.ai).toMatchObject({ apiKey: "test-only-claude" });
  });
  it("reports missing OpenAI access without disabling the configured reply model", () => {
    const config = parseServerConfig({ ...base, AI_ROUTING_PROVIDER: "openai" });
    expect(config.routing.status).toBe("unavailable"); expect(config.ai.status).toBe("ready");
  });
  it("does not send an arbitrary Responses model to OpenAI Decisions", () => {
    expect(parseServerConfig({ ...base, AI_ROUTING_PROVIDER: "openai", AI_ROUTING_MODEL_ID: "gpt-5-mini", OPENAI_API_KEY: "test-only-openai" }).routing).toMatchObject({ status: "unavailable" });
  });
  it("uses Haiku's category as guidance without inventing a probability or switching the answer model", async () => {
    vi.stubEnv("AI_ROUTINE_MODEL_ID", "explicit-routine"); resetServerConfigForTests();
    decide.mockResolvedValue({ answers: { route: { choice: "recovery" } }, response: { modelId: "claude-haiku-5-5" }, usage: { inputTokens: 40, outputTokens: 5 } });
    const selected = await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" });
    expect(selected).toMatchObject({ tier: "main", modelId: "claude-sonnet-5-5", trace: { status: "classified", route: "recovery", probability: null, outputTokens: 5 } });
    expect(selected.guidance).toContain("current order"); expect(selected).not.toHaveProperty("text");
  });
  it("keeps routine classifications without distributions on the main answer model", async () => {
    vi.stubEnv("AI_ROUTINE_MODEL_ID", "explicit-routine"); resetServerConfigForTests();
    decide.mockResolvedValue({ answers: { route: { choice: "routine" } }, response: { modelId: "claude-haiku-5-5" }, usage: {} });
    expect(await routeAssistantTurn({ role: "buyer", messages: [], currentState: "" })).toMatchObject({ tier: "main", trace: { status: "classified", probability: null, inputTokens: null, outputTokens: null } });
  });
  it("accepts a structured classification connection check without pretending it supplies probabilities", async () => {
    verify.mockResolvedValue({ ok: true });
    decide.mockResolvedValue({ answers: { check: { choice: "equal" } } });
    const result = await verifyAiSetup();
    expect(result.ok).toBe(true); expect(result.detail).toContain("structured classification"); expect(result.detail).not.toContain("Jev");
  });
});
