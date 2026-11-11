/**
 * @fileoverview Unit tests for reloading a page left open across a deploy.
 * @module tests/unit/stale-build-reload
 *
 * A stale page reloads once; a second failure within a minute does not reload again.
 */
import { describe, expect, it } from "vitest";
import { mayReload } from "@/components/stale-build-reload";

describe("mayReload", () => {
  it("reloads when it never has, or not for over a minute", () => {
    expect(mayReload(100_000, null)).toBe(true);
    expect(mayReload(200_000, "100000")).toBe(true);
  });

  it("does not reload again within a minute, so an outage cannot loop", () => {
    expect(mayReload(130_000, "100000")).toBe(false);
  });
});
