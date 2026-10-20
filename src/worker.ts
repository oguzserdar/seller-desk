/** Cloudflare entry: sockets and database-backed adapters belong to one invocation. */
import handler from "vinext/server/fetch-handler";
import { createDb } from "./server/db/client";
import { getServerConfig } from "./server/env";
import { runDueWork } from "./server/jobs/run";
import {
  requireRequestScope,
  withD1Database,
  withRequestDatabase,
} from "./server/request-scope";
import { createD1Db, type D1Binding } from "./server/storage/d1/client";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { cloudflareTrialFactory } from "./server/simulation/cloudflare-sqlite";
export { SimulationDatabase } from "./server/simulation/cloudflare-sqlite";

requireRequestScope();

type WorkerBindings = {
  DB?: D1Binding;
  SIMULATIONS: DurableObjectNamespace;
};

function inInvocation<T>(env: WorkerBindings, operation: () => T): T {
  const config = getServerConfig();
  const trialFactory = cloudflareTrialFactory(env.SIMULATIONS);
  if (config.databaseKind === "d1") {
    if (!env.DB)
      throw new Error("DATABASE_KIND=d1 requires the native DB binding.");
    return withD1Database(
      createD1Db(env.DB),
      operation,
      trialFactory,
    );
  }
  if (!config.databaseUrl) throw new Error("PostgreSQL requires DATABASE_URL.");
  // Workers permits six connections in their initial waiting phase at once.
  // Bound database connection setup to five; the pool opens lazily.
  const { db } = createDb(
    config.databaseUrl,
    Math.min(config.databasePoolMax, 5),
  );
  // Do not end the pool when fetch returns: the response may still be streaming.
  // Workers closes invocation-owned sockets when the invocation finishes.
  return withRequestDatabase(db, operation, trialFactory);
}

export default {
  ...handler,
  fetch(...args: Parameters<typeof handler.fetch>): Promise<Response> {
    return inInvocation(args[1] as WorkerBindings, () =>
      handler.fetch(...args),
    );
  },
  async scheduled(_controller: unknown, env: WorkerBindings): Promise<void> {
    const summary = await inInvocation(env, () => runDueWork("scheduled"));
    console.info("Seller Desk recovery", summary);
  },
};
