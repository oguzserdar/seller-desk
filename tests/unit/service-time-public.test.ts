/**
 * The buyer sees the time the shop confirmed, never the shop's private
 * follow-up notes, and older orders keep the general wording.
 */
import { describe, expect, it } from "vitest";
import { describeTask } from "@/server/domain/orders";

const followUps = [{ note: "Called, no answer. Try after 5.", recordedAt: "2026-10-21T10:00:00Z" }];

describe("service time on the buyer's order", () => {
  it("shows the agreed time once the shop confirms it", () => {
    const step = describeTask({ type: "service_followup", state: "completed", lastError: null,
      details: { followUps: [...followUps, { note: "Drop-off Saturday 10:00", recordedAt: "2026-10-21T11:00:00Z" }], confirmedTime: "Drop-off Saturday 10:00" } });
    expect(step.detail).toBe("Agreed with the shop: Drop-off Saturday 10:00");
    expect(step.detail).not.toContain("no answer");
  });

  it("never shows a private follow-up note while the time is still open", () => {
    const step = describeTask({ type: "service_followup", state: "in_progress", lastError: null, details: { followUps } });
    expect(step.detail).not.toContain("no answer");
  });

  it("keeps the general wording for orders confirmed before the time was shared", () => {
    const step = describeTask({ type: "service_followup", state: "completed", lastError: null, details: { followUps } });
    expect(step.detail).toBe("The shop recorded the confirmed time.");
  });
});
