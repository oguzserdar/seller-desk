/** Infrastructure limits only. No successful assistant text or AI acceptance result is fabricated. */
import { expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/server/db/sqlite/schema";
import { withD1Database } from "@/server/request-scope";
import { saveProcedure } from "@/server/domain/assistant-procedures";
import { hasUsageLeft, requireUsage } from "@/server/domain/usage";
import { claimSimulation, saveSimulationResult, simulationSnapshotForSide } from "@/server/simulation/runs";
import { withFreshSimulation } from "@/server/simulation/trial-database";
import { installSimulationShop } from "@/server/simulation/install-snapshot";
import type { SimulationSideResult } from "@/lib/simulation";
import { newStorageFixture } from "../support/storage-fixture";
import { newTrialDurableObject } from "../support/trial-durable-object";

it("keeps a full two-side, eight-turn receipt lifecycle below D1 Free's source query limit with owner-auth headroom", async () => {
  const fixture = await newStorageFixture("d1");
  let count = 0;
  const db = drizzle(fixture.binding!, { schema, logger: { logQuery: () => count++ } });
  try {
    await withD1Database(db, async () => {
      const id = crypto.randomUUID();
      await saveProcedure(fixture.owner, { id, expectedRevision: 0, content: { title: "Repair timing", whenToUse: "A customer has a repair deadline.", steps: "Ask the owner before promising a completion date." } });
      count = 0;
      const input = { requestId: crypto.randomUUID(), scenario: "Isabel needs a repair by Friday.", expectedOutcome: "Ask the seller before committing.", change: { kind: "instruction" as const, id, revision: 1 } };
      let { row } = await claimSimulation(fixture.owner, input, "storage-budget-contract");
      await requireUsage("simulation", fixture.owner.sellerId, 600, 5, "Limit reached.");
      expect(await hasUsageLeft("seller_ai_day", fixture.owner.sellerId, 86400, 100)).toBe(true);
      const evidence: SimulationSideResult = { transcript: [{ role: "user", text: "Storage budget contract only; no model ran." }], tools: [], approvals: [], records: { quotes: 0, paidOrders: 0, captures: 0, pendingTasks: 0, completedTasks: 0, openSellerQuestions: 0 }, checks: [{ label: "No AI acceptance result", passed: false, detail: "This test measures source database queries only." }], latencyMs: 0, inputTokens: null, outputTokens: null };
      for (const side of ["current", "proposed"] as const) {
        await withFreshSimulation(fixture.owner, async () => { await installSimulationShop(simulationSnapshotForSide(row, side)); });
        // Charge every permitted turn on the original shop, as the real runner does.
        for (let turn = 0; turn < 4; turn++) await requireUsage("seller_ai_day", fixture.owner.sellerId, 86400, 100, "Limit reached.");
        row = await saveSimulationResult(fixture.owner, row.id, side, evidence);
      }
      expect(row.state).toBe("completed");
      expect(count).toBeLessThanOrEqual(40); // At least ten of the fifty statements remain for authentication/action middleware.
      console.info(`Two-side source lifecycle: ${count} D1 statements; AI not executed.`);
    });
    expect(await fixture.query("SELECT id FROM orders")).toEqual([]);
  } finally { await fixture.close(); }
});

it("shares the 750 internal storage request ceiling across trial sides and keeps cleanup available", async () => {
  const runtime = await newTrialDurableObject();
  const first = await runtime.factory(), second = await runtime.factory();
  try {
    for (let request = 0; request < 375; request++) await first.binding.prepare("SELECT 1 AS value").all();
    for (let request = 0; request < 375; request++) await second.binding.prepare("SELECT 1 AS value").all();
    await expect(second.binding.prepare("SELECT 1 AS value").all()).rejects.toMatchObject({ code: "unavailable" });
  } finally { await first.close(); await second.close(); await runtime.close(); }
});
