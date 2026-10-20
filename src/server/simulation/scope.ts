/** Full-tool simulation isolation. No route or browser input can select an execution database. */
import {
  createFixtureTransport,
  FIXTURE_MERCHANT_ID,
} from "@/fixtures/paypal-fixture";
import { createDb, getDb } from "@/server/db/client";
import { installation, seller } from "@/server/db/schema";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getServerConfig, type ServerConfig } from "@/server/env";
import { getRequestScope, withSimulationScope } from "@/server/request-scope";
import type { D1Binding } from "@/server/storage/d1/client";
import { withD1Simulation } from "@/server/storage/d1/simulation-scope";
import { and, eq, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";

/** Trusted destination supplied by the operator, never accepted from browser input. */
export type SimulationTarget = string | { kind: "d1"; binding: D1Binding };

/**
 * Runs completed work on a separate operator-selected, already migrated fixture
 * database. Never creates, resets or deletes databases. Failed records survive.
 * The owner is checked against the current shop before opening the target.
 * Callers must consume streams inside operation before its promise resolves.
 * No raw connection string or configuration may be returned to the browser.
 */
export async function withIsolatedSimulation<T>(
  owner: OwnerPrincipal,
  destination: SimulationTarget,
  operation: () => Promise<T>,
): Promise<T> {
  if (getRequestScope()?.simulation)
    throw new Error("Nested simulations are not supported.");
  const native = getRequestScope()?.d1;
  if (typeof destination !== "string") {
    if (!native) throw new Error("D1 trials require a D1 source installation.");
    return withD1Simulation(native, owner, destination.binding, operation);
  }
  if (native)
    throw new Error("D1 simulations require a separate native D1 binding.");
  const databaseUrl = destination;
  const source = getDb();
  const [shop] = await source
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  if (!shop) throw notFound("shop");
  const base = getServerConfig();
  const target = new URL(databaseUrl);
  const name = target.pathname.slice(1);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !/^[a-z0-9_]+_simulation$/.test(name)
  ) {
    throw new Error("Use a dedicated database whose name ends in _simulation.");
  }
  const current = await source.execute<{ name: string }>(
    sql`select current_database() as name`,
  );
  if (name === current.rows[0]?.name)
    throw new Error(
      "The simulation database must differ from the shop database.",
    );
  const isolated = createDb(databaseUrl, 2);
  try {
    const identity = await isolated.db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    if (
      identity.rows[0]?.name !== name ||
      identity.rows[0]?.name === current.rows[0]?.name
    )
      throw new Error("Simulation database identity could not be verified.");
    const rows = await isolated.db
      .select({ environment: installation.environment })
      .from(installation);
    if (rows.length !== 1 || rows[0]?.environment !== "fixture")
      throw new Error(
        "Simulation requires an explicitly installed fixture database.",
      );
    const config: ServerConfig = {
      ...base,
      mode: "fixture",
      databaseKind: "postgres",
      databaseUrl,
      databasePoolMax: 2,
      // Stable per simulation database so saved capabilities survive a later
      // comparison request, without sharing the real shop's signing keys.
      authSecret: createHmac("sha256", base.authSecret)
        .update(`seller-desk-simulation-auth:${name}`)
        .digest("hex"),
      jobsSecret: createHmac("sha256", base.jobsSecret)
        .update(`seller-desk-simulation-jobs:${name}`)
        .digest("hex"),
      paypal: { status: "fixture" },
      store: null,
    };
    return await withSimulationScope(
      {
        db: isolated.db,
        simulation: { config },
        paypal: {
          ok: true,
          payeeMerchantId: FIXTURE_MERCHANT_ID,
          transport: createFixtureTransport(isolated.db, {
            appUrl: config.appUrl,
            secret: config.jobsSecret,
          }),
        },
      },
      operation,
    );
  } finally {
    await isolated.pool.end();
  }
}
