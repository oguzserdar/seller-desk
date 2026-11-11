/**
 * @fileoverview Unit tests for how a rate limit says when to try again.
 * @module tests/unit/usage-wording
 *
 * Short waits read in minutes, long daily waits in hours, and the sentence appears once.
 */
import { describe, expect, it } from "vitest";
import { tryAgainIn } from "@/server/domain/usage";

describe("tryAgainIn", () => {
  it("says minutes for a short wait, never zero", () => {
    expect(tryAgainIn(8.2 * 60_000)).toBe("Try again in about 9 minutes.");
    expect(tryAgainIn(10)).toBe("Try again in about 1 minute.");
  });

  it("says hours for a daily limit instead of hundreds of minutes", () => {
    expect(tryAgainIn(20 * 3_600_000)).toBe("Try again in about 20 hours.");
  });
});
