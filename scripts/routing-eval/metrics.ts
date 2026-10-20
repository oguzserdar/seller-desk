import type { RoutingCase } from "./cases";

/** A real attempt or explicit provider failure, with absent measurements retained as null. */
export type RoutingObservation = {
  id: string;
  expected: RoutingCase["expected"];
  route: RoutingCase["expected"] | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  selectedProbability: number | null;
  confidence: number | null;
  reversed: boolean;
  error: string | null;
};

/** Reports failures in the denominator and separates covered cases from conditional accuracy. */
export function routingMetrics(rows: RoutingObservation[]) {
  const succeeded = rows.filter((r) => r.route !== null && r.error === null);
  const ms = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => ms.length ? ms[Math.ceil(ms.length * p) - 1] : null;
  const correct = succeeded.filter((r) => r.route === r.expected).length;
  const byRoute = Object.fromEntries((["routine", "recovery", "complex", "seller"] as const).map((route) => {
    const expected = rows.filter((r) => r.expected === route);
    return [route, { attempts: expected.length, correct: expected.filter((r) => r.route === route && r.error === null).length }];
  }));
  return { attempts: rows.length, completed: succeeded.length, failed: rows.length - succeeded.length, correct,
    accuracyIncludingFailures: rows.length ? correct / rows.length : null,
    accuracyOnCompleted: succeeded.length ? correct / succeeded.length : null,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), byRoute,
    wronglySentToRoutine: succeeded.filter((r) => r.route === "routine" && r.expected !== "routine").map((r) => r.id),
    inputTokens: rows.length && rows.every((r) => r.inputTokens !== null) ? rows.reduce((sum, r) => sum + r.inputTokens!, 0) : null,
    outputTokens: rows.length && rows.every((r) => r.outputTokens !== null) ? rows.reduce((sum, r) => sum + r.outputTokens!, 0) : null,
  };
}
