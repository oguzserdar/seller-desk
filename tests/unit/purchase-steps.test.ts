/**
 * The purchase ladder keeps requested, priced, paid and the next obligation
 * separate, and never claims a step the records do not show.
 */
import { describe, expect, it } from "vitest";
import { purchaseSteps, type PurchaseStepsInput } from "@/lib/purchase-steps";

const repair: PurchaseStepsInput = {
  status: "consumed",
  lines: [{ kind: "service", title: "Custom bike repair", fulfillmentNote: "Drop-off by arrangement." }],
  totalMinor: 11500, currency: "USD", approvedScope: "Front brake cable and front pads.",
  policy: { pickupPolicy: null, serviceRequestPolicy: "We contact you within one business day to agree timing.", digitalAccessPolicy: null },
  payment: { state: "paid" }, order: { number: 1001 },
};
const states = (input: PurchaseStepsInput) => purchaseSteps(input).map((step) => `${step.key}:${step.state}`);

describe("purchase steps", () => {
  it("a paid custom repair shows priced and paid as done, and timing still to agree", () => {
    const steps = purchaseSteps(repair);
    expect(states(repair)).toEqual(["request:done", "priced:done", "paid:done", "next-service:waiting"]);
    expect(steps[1]).toMatchObject({ label: "Priced by the shop", value: null }); // the panel total already shows the amount
    expect(steps[2]).toMatchObject({ value: "#1001" });
    expect(steps[3]).toMatchObject({ label: "Timing to agree", detail: "We contact you within one business day to agree timing." });
    expect(steps.some((step) => /booked|done|completed/i.test(step.label))).toBe(false);
  });

  it("a payment PayPal has not confirmed is never shown as paid", () => {
    const input = { ...repair, status: "accepted", order: null, payment: { state: "approved" } };
    expect(states(input)).toEqual(["request:done", "priced:done", "paid:waiting", "next-service:todo"]);
    expect(purchaseSteps(input)[2]?.detail).toMatch(/Do not pay again/);
  });

  it("a quote the shop is still checking has no price and no payment step done", () => {
    const input = { ...repair, status: "seller_review", totalMinor: null, approvedScope: null, order: null, payment: null };
    expect(states(input)).toEqual(["request:done", "priced:waiting", "paid:todo", "next-service:todo"]);
    expect(purchaseSteps(input)[1]?.value).toBeNull();
  });

  it("stopped quotes end the ladder instead of implying progress", () => {
    expect(states({ ...repair, status: "expired", order: null, payment: null })).toEqual(["request:done", "priced:stopped"]);
    expect(states({ ...repair, status: "needs_information", totalMinor: null, order: null, payment: null })[1]).toBe("priced:stopped");
  });

  it("a request missing its description asks the buyer for it instead of claiming it was sent", () => {
    const steps = purchaseSteps({ ...repair, status: "needs_information", totalMinor: null, order: null, payment: null, unresolved: [{ code: "details_needed" }] });
    expect(steps[0]).toMatchObject({ key: "request", label: "Describe the work", state: "attention" });
    expect(steps[1]).toMatchObject({ key: "priced", label: "Shop prices it", state: "todo" });
    expect(steps.map((step) => step.label)).not.toContain("Request sent");
  });

  it("after payment each next step follows the order's own task: a delivered download is done, not waiting", () => {
    const download: PurchaseStepsInput = { ...repair, lines: [{ kind: "digital", title: "Home brake care guide", fulfillmentNote: "" }], approvedScope: null,
      policy: { pickupPolicy: null, serviceRequestPolicy: null, digitalAccessPolicy: "Your download link works for 30 days." },
      order: { number: 1003, tasks: [{ type: "digital_access", state: "completed" }] } };
    expect(purchaseSteps(download).at(-1)).toMatchObject({ label: "Download ready", state: "done", detail: null });
    const failed = { ...download, order: { number: 1003, tasks: [{ type: "digital_access", state: "attention" }] } };
    expect(purchaseSteps(failed).at(-1)).toMatchObject({ label: "Download needs a retry", state: "attention" });
  });

  it("a paid service shows agreeing a time and finishing the work as two separate recorded steps", () => {
    const input = { ...repair, order: { number: 1001, tasks: [{ type: "service_followup", state: "open" }, { type: "service_work", state: "open" }] } };
    expect(purchaseSteps(input).slice(3).map((step) => `${step.label}:${step.state}`)).toEqual(["Timing to agree:waiting", "Work still to finish:waiting"]);
    const done = { ...repair, order: { number: 1001, tasks: [{ type: "service_followup", state: "completed" }, { type: "service_work", state: "completed" }] } };
    expect(purchaseSteps(done).slice(3).map((step) => `${step.label}:${step.state}`)).toEqual(["Time agreed:done", "Work finished:done"]);
  });

  it("each kind gets its own next step from the shop's terms, falling back to the offer's note", () => {
    const mixed: PurchaseStepsInput = { ...repair, lines: [
      { kind: "digital", title: "Pattern sheets", fulfillmentNote: "" },
      { kind: "goods", title: "Disc brake pads", fulfillmentNote: "Collect at the counter." },
    ], policy: { pickupPolicy: null, serviceRequestPolicy: null, digitalAccessPolicy: "Downloads stay open for 30 days." } };
    const next = purchaseSteps(mixed).slice(3);
    expect(next.map((step) => [step.label, step.detail])).toEqual([["Pickup", "Collect at the counter."], ["Download from your order", "Downloads stay open for 30 days."]]);
  });
});
