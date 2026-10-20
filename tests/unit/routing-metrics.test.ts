import { describe, expect, it } from "vitest";
import { routingQuestions, ROUTING_CASES } from "../../scripts/routing-eval/cases";
import { routingMetrics, type RoutingObservation } from "../../scripts/routing-eval/metrics";

const row = (patch: Partial<RoutingObservation>): RoutingObservation => ({ id: "case", expected: "routine", route: "routine", latencyMs: 200, inputTokens: 100, outputTokens: 0, selectedProbability: null, confidence: null, reversed: false, error: null, ...patch });

describe("routing comparison integrity", () => {
  it("counts provider failures as failures, not successful classification", () => {
    const report = routingMetrics([row({}), row({ route: null, error: "timeout", inputTokens: null, outputTokens: null, latencyMs: 8000 })]);
    expect(report.accuracyIncludingFailures).toBe(0.5);
    expect(report.accuracyOnCompleted).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.p95Ms).toBe(8000);
    expect(report.inputTokens).toBeNull();
  });
  it("separates risky under-routing from overall accuracy", () => {
    const report = routingMetrics([row({ id: "payment", expected: "recovery" }), row({ id: "human", expected: "seller", route: "seller" })]);
    expect(report.wronglySentToRoutine).toEqual(["payment"]);
    expect(report.byRoute.seller).toEqual({ attempts: 1, correct: 1 });
  });
  it("does not claim accuracy or latency without observations", () => {
    expect(routingMetrics([]).accuracyIncludingFailures).toBeNull();
    expect(routingMetrics([]).p50Ms).toBeNull();
    expect(routingMetrics([]).inputTokens).toBeNull();
    expect(routingMetrics([]).outputTokens).toBeNull();
  });
  it("reverses option order without changing criteria or leaking expected labels", () => {
    const normal = routingQuestions();
    const reversed = routingQuestions(true);
    expect(Object.keys(reversed.route.criteria)).toEqual(Object.keys(normal.route.criteria).reverse());
    expect(reversed.route.criteria).toEqual(normal.route.criteria);
    expect(new Set(ROUTING_CASES.map((c) => c.id)).size).toBe(ROUTING_CASES.length);
    expect(ROUTING_CASES.some((c) => c.id === "turkish-recovery")).toBe(true);
  });
});
