import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../../src/server/env";
import { assistantCallSettings } from "../../src/server/ai/registry";
import { TEST_ENV } from "../support/test-env";

describe("how hard the assistant thinks before each step", () => {
  it("leaves the provider default when AI_REASONING is not set", () => {
    const config = parseServerConfig({ ...TEST_ENV });
    expect(config.aiReasoning).toBeUndefined();
    expect(assistantCallSettings(config)).not.toHaveProperty("reasoning");
  });
  it("passes a chosen level to every assistant call", () => {
    const config = parseServerConfig({ ...TEST_ENV, AI_REASONING: "low" });
    expect(config.aiReasoning).toBe("low");
    expect(assistantCallSettings(config)).toMatchObject({ reasoning: "low" });
  });
  it("refuses a value the AI SDK does not accept", () => {
    expect(() => parseServerConfig({ ...TEST_ENV, AI_REASONING: "fast" })).toThrow("AI_REASONING");
  });
});
