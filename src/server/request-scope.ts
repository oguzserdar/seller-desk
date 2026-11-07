/** Request-owned database clients and the adapters that retain them. */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SellerDeskAuth } from "./auth/auth";
import type { Db } from "./db/client";
import type { ServerConfig } from "./env";
import type { TransportResolution } from "./paypal";
import type { D1Db } from "./storage/d1/client";
import type { TrialDatabaseFactory } from "./simulation/trial-database";

/** Mutable objects belong to this invocation; installation settings stay immutable. */
export type RequestScope = (
  | { db: Db; d1?: never }
  | { db?: never; d1: D1Db }
) & {
  trialDatabaseFactory?: TrialDatabaseFactory;
  auth?: SellerDeskAuth;
  paypal?: TransportResolution;
  frameOrigins?: Promise<string[]>;
  /**
   * A trial's settings, and where its model spend is recorded: the real shop's
   * database, so a test still counts against the AI budget.
   */
  simulation?: { config: ServerConfig; recordSpend?: (micros: number) => Promise<void> };
  /** This request's settings with any connection saved in Setup applied; read once per request. */
  effectiveConfig?: Promise<ServerConfig>;
};

const storage = new AsyncLocalStorage<RequestScope>();
let required = false;

/** Worker entry points require a scope instead of silently creating a global pool. */
export function requireRequestScope(): void {
  required = true;
}

/** Returns this invocation's objects; Node hosts may use their ordinary process pool. */
export function getRequestScope(): RequestScope | undefined {
  const scope = storage.getStore();
  if (!scope && required)
    throw new Error("Database work requires an active Worker request scope.");
  return scope;
}

/**
 * Retains the database through asynchronous work, including streamed replies.
 * The caller owns connection cleanup; Workers ends sockets with the invocation.
 */
export function withRequestDatabase<T>(db: Db, operation: () => T, trialDatabaseFactory?: TrialDatabaseFactory): T {
  return storage.run({ db, trialDatabaseFactory }, operation);
}

/** Retains one native D1 binding through asynchronous operations and streamed replies. */
export function withD1Database<T>(
  d1: D1Db,
  operation: () => T,
  trialDatabaseFactory?: TrialDatabaseFactory,
): T {
  return storage.run({ d1, trialDatabaseFactory }, operation);
}

/** Reads only a server-established simulation override, without requiring a Worker database scope at boot. */
export function simulationConfig(): ServerConfig | undefined {
  return storage.getStore()?.simulation?.config;
}

/** Internal execution context. Call through the owner/database checks in withIsolatedSimulation. */
export function withSimulationScope<T>(
  scope: RequestScope & {
    simulation: { config: ServerConfig };
    paypal: TransportResolution;
  },
  operation: () => T,
): T {
  return storage.run(scope, operation);
}
