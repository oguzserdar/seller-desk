/** Fresh per-side trial databases shared by seller-facing tests on both hosts. */
import { getSeller } from "@/server/domain/seller";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getServerConfig } from "@/server/env";
import { getRequestScope, withSimulationScope } from "@/server/request-scope";
import { createD1Db, type D1Binding } from "@/server/storage/d1/client";
import { createD1FixtureTransport } from "@/server/storage/d1/fixture-paypal";
import { FIXTURE_MERCHANT_ID } from "@/fixtures/paypal-fixture";
import { TRIAL_SCHEMA } from "./trial-schema";
import { newNodeTrialDatabase } from "@/server/simulation/node-sqlite";

/** A newly allocated isolated database; only its creator can close it. */
export type FreshTrialDatabase = { binding: D1Binding; close: () => void | Promise<void> };
/** Host-selected allocation. Never accepted from an HTTP body or model tool. */
export type TrialDatabaseFactory = () => Promise<FreshTrialDatabase>;

/** Proves original ownership, then installs a fresh fictional schema with independent signing keys. */
export async function withFreshSimulation<T>(owner: OwnerPrincipal, operation: () => Promise<T>): Promise<T> {
  if (getRequestScope()?.simulation) throw new Error("Nested trials are forbidden.");
  const shop = await getSeller();
  if (!shop || shop.id !== owner.sellerId || shop.ownerUserId !== owner.userId) throw notFound("shop");
  const factory = getRequestScope()?.trialDatabaseFactory;
  const isolated = factory ? await factory() : newNodeTrialDatabase();
  try {
    // Actual generated D1 migrations, not a second handwritten simulation schema.
    for (let i = 0; i < TRIAL_SCHEMA.length; i += 24) {
      await isolated.binding.batch(TRIAL_SCHEMA.slice(i, i + 24).map(statement => isolated.binding.prepare(statement)));
    }
    const db = createD1Db(isolated.binding);
    const { installation } = await import("@/server/db/sqlite/schema");
    await db.insert(installation).values({ environment: "fixture" });
    const base = getServerConfig();
    const config = { ...base, mode: "fixture" as const, databaseKind: "d1" as const, databaseUrl: null,
      authSecret: crypto.randomUUID() + crypto.randomUUID(), jobsSecret: crypto.randomUUID() + crypto.randomUUID(),
      paypal: { status: "fixture" as const }, store: null };
    return await withSimulationScope({ d1: db, simulation: { config }, paypal: {
      ok: true, payeeMerchantId: FIXTURE_MERCHANT_ID,
      transport: createD1FixtureTransport(db, { appUrl: config.appUrl, secret: config.jobsSecret }),
    } }, operation);
  } finally {
    try { await isolated.close(); }
    catch { console.warn("Trial cleanup deferred to its expiry alarm."); }
  }
}
