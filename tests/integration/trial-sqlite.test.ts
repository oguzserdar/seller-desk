/** Actual SQLite engines, schema and commerce actors. No model success is mocked or claimed. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newNodeTrialDatabase } from "@/server/simulation/node-sqlite";
import { isBatchGuardFailure } from "@/server/storage/d1/guards";
import { TRIAL_SCHEMA } from "@/server/simulation/trial-schema";
import type { FreshTrialDatabase } from "@/server/simulation/trial-database";
import { newTrialDurableObject } from "../support/trial-durable-object";
import { readFileSync, readdirSync } from "node:fs";

for (const host of ["node", "worker"] as const) describe(`${host}: fresh trial SQLite protocol`, () => {
  let trial: FreshTrialDatabase;
  let runtime: Awaited<ReturnType<typeof newTrialDurableObject>> | undefined;
  beforeEach(async () => {
    if (host === "worker") { runtime = await newTrialDurableObject(); trial = await runtime.factory(); }
    else trial = newNodeTrialDatabase();
  });
  afterEach(async () => { await trial?.close(); await runtime?.close(); });
  it("executes the real migration bytes and keeps blobs, raw column positions and batch rollback", async () => {
    const expected = readdirSync("drizzle-d1").filter(n => n.endsWith(".sql")).sort().flatMap(name => readFileSync(`drizzle-d1/${name}`, "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean));
    expect(TRIAL_SCHEMA).toEqual(expected);
    for (let i = 0; i < TRIAL_SCHEMA.length; i += 24) await trial.binding.batch(TRIAL_SCHEMA.slice(i, i + 24).map(sql => trial.binding.prepare(sql)));
    const probe = trial.binding.prepare("CREATE TABLE probe(id INTEGER PRIMARY KEY, bytes BLOB, count INTEGER CHECK(count > 0))");
    await probe.run();
    await trial.binding.prepare("INSERT INTO probe VALUES (?, ?, ?)").bind(1, new Uint8Array([0, 255, 7]), 1).run();
    const raw = await trial.binding.prepare("SELECT id AS repeated, count AS repeated, bytes FROM probe").raw();
    expect(raw[0]?.slice(0, 2)).toEqual([1, 1]);
    expect([...new Uint8Array(raw[0]![2] as ArrayBuffer)]).toEqual([0, 255, 7]);
    const read = await trial.binding.prepare("SELECT * FROM probe").all();
    expect(read.meta.changes).toBe(0);
    await expect(trial.binding.batch([
      trial.binding.prepare("UPDATE probe SET count=2 WHERE id=1"),
      trial.binding.prepare("UPDATE probe SET count=0 WHERE id=1"),
    ])).rejects.toThrow();
    expect(await trial.binding.prepare("SELECT count FROM probe WHERE id=1").first("count")).toBe(1);
  });
  it("preserves the known optimistic guard category across the Worker boundary without echoing data", async () => {
    await trial.binding.prepare("CREATE TABLE guarded(value TEXT, CONSTRAINT operation_key_state_valid CHECK(value = 'valid'))").run();
    let failure: unknown;
    try { await trial.binding.prepare("INSERT INTO guarded VALUES (?)").bind("private-customer-value").run(); } catch (error) { failure = error; }
    expect(isBatchGuardFailure(failure)).toBe(true);
    if (host === "worker") expect(String(failure)).not.toContain("private-customer-value");
  });
  it("allocates another empty database without changing the first one", async () => {
    await trial.binding.prepare("CREATE TABLE independent(id INTEGER)").run();
    const second = host === "worker" ? await runtime!.factory() : newNodeTrialDatabase();
    try { expect(await second.binding.prepare("SELECT name FROM sqlite_master WHERE name='independent'").all()).toMatchObject({ results: [] }); }
    finally { await second.close(); }
    expect(await trial.binding.prepare("SELECT name FROM sqlite_master WHERE name='independent'").first("name")).toBe("independent");
  });
});
