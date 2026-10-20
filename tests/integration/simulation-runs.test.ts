/** Real-database run lifecycle contracts. Storage fixtures contain no scripted assistant replies. */
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { SimulationInput, SimulationSideResult } from "@/lib/simulation";
import { getDb } from "@/server/db/client";
import { auditEvent, simulationRun } from "@/server/db/schema";
import { pauseProcedure, publishProcedure, saveProcedure } from "@/server/domain/assistant-procedures";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { claimSimulation, failSimulation, listSimulations, saveSimulationResult, simulationSnapshotForSide } from "@/server/simulation/runs";
import { resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const original = { title: "Repair questions", whenToUse: "When a customer wants a repair", steps: "Ask the owner before promising a completion date." };
const proposed = { ...original, steps: "Ask for the wheel diameter before asking the owner. Retain the budget and deadline." };
const evidence: SimulationSideResult = {
  transcript: [{ role: "user", text: "Storage contract fixture. No AI reply was generated." }], tools: [], approvals: [],
  records: { quotes: 0, paidOrders: 0, captures: 0, pendingTasks: 0, completedTasks: 0, openSellerQuestions: 0 },
  checks: [{ label: "No live model in this storage test", passed: false, detail: "A persistence contract is not an assistant acceptance result." }],
  latencyMs: 0, inputTokens: null, outputTokens: null,
};
beforeEach(async () => { ({ owner } = await resetShop()); });
function baseline(): SimulationInput {
  return { requestId: crypto.randomUUID(), scenario: "I need a bike repair before Friday, under $150.", expectedOutcome: "Ask before promising the deadline or taking payment.", change: { kind: "none" } };
}
async function comparison(): Promise<SimulationInput> {
  const id = crypto.randomUUID();
  await saveProcedure(owner, { id, expectedRevision: 0, content: original });
  await publishProcedure(owner, { id, expectedRevision: 1, approve: true });
  await saveProcedure(owner, { id, expectedRevision: 1, content: proposed });
  return { ...baseline(), change: { kind: "instruction", id, revision: 2 } };
}

it("pins approved and proposed versions, preserves retry evidence after later edits, and leaves commerce alone", async () => {
  const input = await comparison(), before = await tally();
  const run = await claimSimulation(owner, input, "storage-contract");
  expect(run.row.snapshot.procedures[0]?.content).toEqual(original);
  expect(run.row.change?.content).toEqual(proposed);
  const currentSide = simulationSnapshotForSide(run.row, "current"), proposedSide = simulationSnapshotForSide(run.row, "proposed");
  expect(currentSide.procedures[0]?.content).toEqual(original); expect(proposedSide.procedures[0]?.content).toEqual(proposed);
  proposedSide.shop.displayName = "Changed inside a fictional trial";
  expect(run.row.snapshot.shop.displayName).not.toBe(proposedSide.shop.displayName);
  expect(currentSide.shop.displayName).toBe(run.row.snapshot.shop.displayName);
  expect(run.row.snapshot.products.length).toBeGreaterThan(0);
  if (input.change.kind !== "instruction") throw Error("wrong fixture");
  await saveProcedure(owner, { id: input.change.id, expectedRevision: 2, content: { ...proposed, title: "Later draft" } });
  const retry = await claimSimulation(owner, input, "changed-provider-is-not-a-retry");
  expect(retry.created).toBe(false); expect(retry.row).toEqual(run.row);
  expect(await tally()).toEqual(before);
  const [view] = await listSimulations(owner);
  expect(view).not.toHaveProperty("snapshot"); expect(view).not.toHaveProperty("sellerId");
  expect(view?.change?.revision).toBe(2);
});

it("claims identical requests once and refuses changed retries and overlapping tests", async () => {
  const input = baseline();
  const results = await Promise.all([claimSimulation(owner, input, "storage-contract"), claimSimulation(owner, input, "storage-contract")]);
  expect(results.filter(r => r.created)).toHaveLength(1);
  await expect(claimSimulation(owner, { ...input, expectedOutcome: "A different expectation" }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  await expect(claimSimulation(owner, { ...input, requestId: crypto.randomUUID() }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  expect((await getDb().select().from(auditEvent).where(eq(auditEvent.operation, "simulation.start")))).toHaveLength(1);
});

it("requires current ownership for reads, claims, results and failure recording", async () => {
  const input = baseline(); await claimSimulation(owner, input, "storage-contract");
  for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
    await expect(claimSimulation(caller, input, "storage-contract")).rejects.toMatchObject({ code: "not_found" });
    await expect(saveSimulationResult(caller, input.requestId, "current", evidence)).rejects.toMatchObject({ code: "not_found" });
    await expect(failSimulation(caller, input.requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listSimulations(caller)).rejects.toMatchObject({ code: "not_found" });
  }
});

it("preserves partial comparisons after failure and blocks late or out-of-order results", async () => {
  const input = await comparison(); await claimSimulation(owner, input, "storage-contract");
  await expect(saveSimulationResult(owner, input.requestId, "proposed", evidence)).rejects.toMatchObject({ code: "conflict" });
  await saveSimulationResult(owner, input.requestId, "current", evidence);
  await expect(saveSimulationResult(owner, input.requestId, "current", evidence)).rejects.toMatchObject({ code: "conflict" });
  await failSimulation(owner, input.requestId);
  expect((await listSimulations(owner))[0]).toMatchObject({ state: "failed", current: evidence, proposed: null });
  await expect(saveSimulationResult(owner, input.requestId, "proposed", evidence)).rejects.toMatchObject({ code: "conflict" });
});

it("requires both comparison results and distinguishes finished trials from passing checks", async () => {
  const input = await comparison(); await claimSimulation(owner, input, "storage-contract");
  await expect(saveSimulationResult(owner, input.requestId, "current", { ...evidence, transcript: [] })).rejects.toThrow();
  await saveSimulationResult(owner, input.requestId, "current", evidence);
  expect((await listSimulations(owner))[0]?.state).toBe("running");
  await saveSimulationResult(owner, input.requestId, "proposed", evidence);
  await failSimulation(owner, input.requestId);
  expect((await listSimulations(owner))[0]).toMatchObject({ state: "completed", current: evidence, proposed: evidence });
  const single = baseline(); await claimSimulation(owner, single, "storage-contract");
  await saveSimulationResult(owner, single.requestId, "current", evidence);
  expect((await listSimulations(owner)).find(r => r.id === single.requestId)?.state).toBe("completed");
  await expect(saveSimulationResult(owner, single.requestId, "proposed", evidence)).rejects.toMatchObject({ code: "conflict" });
});

it("labels expiry without writing during reads and permits a new run without deleting the old one", async () => {
  const input = baseline(); await claimSimulation(owner, input, "storage-contract");
  await getDb().update(simulationRun).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(simulationRun.id, input.requestId));
  expect((await listSimulations(owner))[0]?.state).toBe("failed");
  expect((await getDb().select().from(simulationRun))[0]?.state).toBe("running");
  await expect(saveSimulationResult(owner, input.requestId, "current", evidence)).rejects.toMatchObject({ code: "conflict" });
  expect((await claimSimulation(owner, { ...input, requestId: crypto.randomUUID() }, "storage-contract")).created).toBe(true);
  expect((await listSimulations(owner))).toHaveLength(2);
  expect((await getDb().select().from(simulationRun).where(eq(simulationRun.id, input.requestId)))[0]?.state).toBe("failed");
});

it("rejects stale or archived drafts without saving a run", async () => {
  const input = await comparison();
  if (input.change.kind !== "instruction") throw Error("wrong fixture");
  await expect(claimSimulation(owner, { ...input, change: { ...input.change, revision: 1 } }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  await pauseProcedure(owner, input.change.id, 2, true);
  await expect(claimSimulation(owner, { ...input, change: { ...input.change, revision: 3 } }, "storage-contract")).rejects.toMatchObject({ code: "conflict" });
  expect(await listSimulations(owner)).toEqual([]);
});


it("saves interrupted baseline evidence atomically as failed, never completed", async () => {
  const input = baseline(); await claimSimulation(owner, input, "storage-contract");
  await saveSimulationResult(owner, input.requestId, "current", evidence, false);
  expect((await listSimulations(owner))[0]).toMatchObject({ state: "failed", current: evidence });
  await expect(saveSimulationResult(owner, input.requestId, "current", evidence)).rejects.toMatchObject({ code: "conflict" });
});
