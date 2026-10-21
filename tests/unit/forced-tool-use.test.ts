import { describe, expect, it } from "vitest";
import { acceptsForcedToolUse } from "@/server/ai/registry";

describe("forced tool use", () => {
  it("is not requested from Claude models that refuse it, on any route", () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"])
      expect(acceptsForcedToolUse(id)).toBe(false);
  });
  it("is still requested from models that accept it", () => {
    for (const id of ["claude-haiku-5-5", "claude-opus-5", "gpt-5-mini", "gemini-3.1-flash"])
      expect(acceptsForcedToolUse(id)).toBe(true);
  });
});
