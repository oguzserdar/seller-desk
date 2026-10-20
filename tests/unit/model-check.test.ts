import { APICallError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAssistantModel } from "../../src/server/ai/registry";
import { resetServerConfigForTests } from "../../src/server/env";
import { aiSetupKey } from "../../src/server/ai/setup-check";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), generateText }));

describe("AI connection capability check (SDK boundary controls, not live-model evidence)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("AI_MODEL_ID", "test-model"); vi.stubEnv("OPENAI_API_KEY", "private-test-key");
    resetServerConfigForTests();
  });
  afterEach(() => { generateText.mockReset(); vi.unstubAllEnvs(); resetServerConfigForTests(); });

  it("does not accept a text-only response as a working seller assistant", async () => {
    generateText.mockResolvedValue({ text: "ready" });
    expect(await verifyAssistantModel()).toMatchObject({ ok: false });
  });

  it("requires the model to return the actual tool result", async () => {
    generateText.mockImplementation(async (options) => {
      await options.tools.read_connection_check.execute({});
      return { text: "ready", output: { observed: "invented" } };
    });
    expect(await verifyAssistantModel()).toMatchObject({ ok: false });
  });

  it("passes only after tool execution and a matching structured result", async () => {
    generateText.mockImplementation(async (options) => {
      const { value } = await options.tools.read_connection_check.execute({});
      expect(options.prompt).not.toContain(value);
      expect(options.output).toBeDefined();
      return { text: "unused", output: { observed: value } };
    });
    expect(await verifyAssistantModel()).toMatchObject({ ok: true, provider: "openai", modelId: "test-model" });
  });

  it("gives an authentication fix without returning echoed keys or provider body text", async () => {
    generateText.mockRejectedValue(new APICallError({ message: "Rejected private-test-key", url: "https://provider.example", requestBodyValues: {}, statusCode: 401, responseBody: "private-test-key" }));
    const result = await verifyAssistantModel();
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("private-test-key");
    if (!result.ok) expect(result.problem).toContain("credential");
  });

  it("does not expose arbitrary exception text", async () => {
    generateText.mockRejectedValue(new Error("internal URL and private-test-key"));
    expect(JSON.stringify(await verifyAssistantModel())).not.toContain("private-test-key");
  });

  it.each([
    [401, "credential"],
    [403, "availability for your account"],
    [404, "model ID"],
    [429, "usage allowance"],
    [503, "service is available"],
  ])("explains wrapped Gateway status %s without exposing its body", async (statusCode, expected) => {
    const cause = new APICallError({ message: "private-test-key", url: "https://provider.example", requestBodyValues: {}, statusCode, responseBody: "private-test-key" });
    generateText.mockRejectedValue(new Error("Gateway error: private-test-key", { cause }));
    const result = await verifyAssistantModel();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(expected);
    expect(JSON.stringify(result)).not.toContain("private-test-key");
  });

  it("does not reuse the old text-only proof", () => {
    expect(aiSetupKey()).not.toBe("openai:test-model");
  });

  it("leaves an unconfigured installation disconnected without making a model request", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); resetServerConfigForTests();
    expect(await verifyAssistantModel()).toMatchObject({ ok: false });
    expect(generateText).not.toHaveBeenCalled();
  });
});
