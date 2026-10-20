/** Failure-only model contracts. Real successful generation is verified separately. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, getDb } from "@/server/db/client";
import { installation, usageBucket } from "@/server/db/schema";
import { PROVIDER_FACTORIES } from "@/server/ai/registry";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { consumeUsage } from "@/server/domain/usage";
import { resetServerConfigForTests } from "@/server/env";
import { executeSimulation } from "@/server/simulation/execute";
import { listSimulations } from "@/server/simulation/runs";
import { TEST_DATABASE_URL } from "../support/test-env";
import { resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
let model: MockLanguageModelV4;
beforeEach(async () => {
  ({ owner } = await resetShop());
  process.env.AI_PROVIDER = "openai"; process.env.AI_MODEL_ID = "failure-contract"; process.env.OPENAI_API_KEY = "test-only-not-a-credential";
  resetServerConfigForTests();
  model = new MockLanguageModelV4({ doStream: async () => { throw new Error("Intentional provider refusal; no successful reply supplied"); } });
  vi.spyOn(PROVIDER_FACTORIES, "openai").mockReturnValue(model);
});
afterEach(() => {
  vi.restoreAllMocks(); delete process.env.AI_PROVIDER; delete process.env.AI_MODEL_ID; delete process.env.OPENAI_API_KEY; resetServerConfigForTests();
});
const scenario = () => ({ requestId: crypto.randomUUID(), scenario: "I need help choosing a mug. Do not charge me.", expectedOutcome: "Explain available options without charging.", change: { kind: "none" as const } });
async function freshTarget() {
  const name = `executor_${Date.now()}_${process.pid}_simulation`;
  await getDb().execute(sql.raw(`create database "${name}"`));
  const url = new URL(TEST_DATABASE_URL); url.pathname = `/${name}`;
  const state = createDb(url.href, 1);
  try { await migrate(state.db, { migrationsFolder: "./drizzle" }); await state.db.insert(installation).values({ environment: "fixture" }); }
  finally { await state.pool.end(); }
  return url.href;
}

it("preserves a failed real handler turn and does not re-run it on a duplicate request", async () => {
  const input = scenario(), target = await freshTarget(), before = await tally();
  const report = await executeSimulation(owner, input, { current: target });
  expect(report.state).toBe("failed");
  expect(report.current?.transcript).toEqual([{ role: "user", text: input.scenario }]);
  expect(report.current?.checks.find(c => c.label === "Turn 1: A real reply finished and was saved")?.passed).toBe(false);
  expect(report.current?.records.captures).toBe(0);
  expect(report.current?.records.paidOrders).toBe(0);
  expect(model.doStreamCalls).toHaveLength(1);
  expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain(input.expectedOutcome);
  const duplicate = await executeSimulation(owner, input, { current: target });
  expect(duplicate).toEqual(report); expect(model.doStreamCalls).toHaveLength(1);
  expect(await tally()).toEqual(before);
  expect((await getDb().select().from(usageBucket).where(eq(usageBucket.feature, "seller_ai_day")))[0]?.count).toBe(1);
});

it("rejects unrelated ownership and invalid comparison targets before model work", async () => {
  await expect(executeSimulation({ ...owner, userId: crypto.randomUUID() }, scenario(), { current: "invalid" })).rejects.toMatchObject({ code: "not_found" });
  const input = { ...scenario(), change: { kind: "instruction" as const, id: crypto.randomUUID(), revision: 1 } };
  await expect(executeSimulation(owner, input, { current: "same", proposed: "same" })).rejects.toMatchObject({ code: "invalid" });
  expect(model.doStreamCalls).toHaveLength(0); expect(await listSimulations(owner)).toEqual([]);
});

it("enforces the original shop daily budget before opening the isolated target", async () => {
  const { seller } = await import("@/server/db/schema");
  await getDb().update(seller).set({ sellerDailyAiTurns: 1 }).where(eq(seller.id, owner.sellerId));
  await consumeUsage("seller_ai_day", owner.sellerId, 86_400, 1);
  // A valid, migrated target: only the budget check can keep it unopened.
  const target = await freshTarget();
  const report = await executeSimulation(owner, scenario(), { current: target });
  expect(report.state).toBe("failed"); expect(report.current).toBeNull();
  expect(model.doStreamCalls).toHaveLength(0);
  const state = createDb(target, 1);
  try { expect((await state.db.select().from(seller)).length).toBe(0); } finally { await state.pool.end(); }
  expect((await getDb().select().from(usageBucket).where(eq(usageBucket.feature, "seller_ai_day")))[0]?.count).toBe(1);
});
