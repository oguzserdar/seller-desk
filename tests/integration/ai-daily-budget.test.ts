/**
 * The daily AI budget on a real D1 database: off without a budget, metered under
 * it, off once today's spend reaches it, and a shop test's spend is recorded in the
 * real shop rather than in its throwaway database. No model is called.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { MockLanguageModelV4 } from "ai/test";
import * as schema from "@/server/db/sqlite/schema";
import { withD1Database } from "@/server/request-scope";
import { spendRecorder, withDailyBudget } from "@/server/ai/spend";
import { withFreshSimulation } from "@/server/simulation/trial-database";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

let fixture: StorageFixture;
beforeEach(async () => { fixture = await newStorageFixture("d1"); });
afterEach(async () => { await fixture?.close(); });

const run = <T>(operation: () => Promise<T>) => withD1Database(drizzle(fixture.binding!, { schema }), operation);
const spentToday = async () => (await fixture.query("SELECT count FROM usage_bucket WHERE feature = 'ai_spend_micros'"))[0]?.count ?? 0;
const model = new MockLanguageModelV4();

it("leaves the model unchanged and counts nothing without a budget", async () => {
  const result = await run(() => withDailyBudget(model, "claude-sonnet-5-5", {}));
  expect(result).toEqual({ ok: true, model });
  expect(await spentToday()).toBe(0);
});

it("turns the assistant off for an unpriced model rather than counting it as free", async () => {
  const result = await run(() => withDailyBudget(model, "some-new-model", { budgetUsd: 3 }));
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.problem).toContain("AI_PRICE_PER_MILLION_TOKENS");
});

it("allows the assistant until today's spend reaches the budget", async () => {
  expect((await run(() => withDailyBudget(model, "claude-sonnet-5-5", { budgetUsd: 1 }))).ok).toBe(true);
  await run(async () => { const record = spendRecorder(); await record(600_000); await record(400_000); });
  expect(await spentToday()).toBe(1_000_000);
  const spent = await run(() => withDailyBudget(model, "claude-sonnet-5-5", { budgetUsd: 1 }));
  expect(spent.ok).toBe(false);
  expect(spent.ok ? "" : spent.problem).toContain("midnight UTC");
});

it("records a shop test's spend in the real shop, not in the trial database", async () => {
  await run(() => withFreshSimulation(fixture.owner, async () => { await spendRecorder()(250_000); }));
  expect(await spentToday()).toBe(250_000);
});
