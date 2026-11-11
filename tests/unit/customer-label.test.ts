/**
 * @fileoverview Unit tests for anonymous customer labels.
 * @module tests/unit/customer-label
 *
 * A label is stable for one conversation, short, and differs between conversations.
 */
import { describe, expect, it } from "vitest";
import { customerLabel } from "@/lib/customer-label";

describe("customerLabel", () => {
  it("gives one conversation the same short label every time", () => {
    const label = customerLabel("conv-0f3a9c");
    expect(label).toMatch(/^Customer [0-9A-Z]{4}$/);
    expect(customerLabel("conv-0f3a9c")).toBe(label);
  });

  it("tells fifty conversations apart", () => {
    const labels = new Set(Array.from({ length: 50 }, (_, index) => customerLabel(crypto.randomUUID() + index)));
    expect(labels.size).toBe(50);
  });
});
