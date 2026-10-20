/**
 * Database access. Node hosts share one bounded pool per process; the pool is
 * created lazily so scripts and tests can set DATABASE_URL first. Correctness
 * never depends on this process staying alive: every record lives in PostgreSQL.
 */
import { getServerConfig } from "@/server/env";
import { getRequestScope } from "@/server/request-scope";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Typed database used by the seller installation. */
export type Db = NodePgDatabase<typeof schema>;
/** Transaction-scoped database operations. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the database or an open transaction. */
export type Queryable = Db | Tx;

type DbState = { pool: Pool; db: Db };
const holder = globalThis as unknown as { __sellerDeskDb?: DbState };

/** Creates an independent connection pool (tests use this to simulate a second app instance). */
export function createDb(connectionString: string, max = 10): DbState {
  // No statement_timeout here: node-postgres would send it in the connection's
  // startup message, which PgBouncer and Supavisor refuse ("unsupported startup
  // parameter"). Transactions set their own limit instead; see transaction().
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "seller-desk",
  });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Workers use the invocation's pool; Node hosts retain a bounded process pool. */
export function getDb(): Db {
  const scope = getRequestScope();
  if (scope) {
    if (scope.db) return scope.db;
    throw new Error(
      "This operation has not been ported to the D1 backend. PostgreSQL fallback is forbidden.",
    );
  }
  const config = getServerConfig();
  if (config.databaseKind !== "postgres" || !config.databaseUrl)
    throw new Error(
      "D1 requires an active native DB binding. PostgreSQL fallback is forbidden.",
    );
  if (!holder.__sellerDeskDb) {
    holder.__sellerDeskDb = createDb(
      config.databaseUrl,
      config.databasePoolMax,
    );
  }
  return holder.__sellerDeskDb.db;
}

/** Longest any statement inside a transaction may run, row-lock waits included. */
export const STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Runs fn in one transaction whose statements time out after STATEMENT_TIMEOUT_MS.
 * The limit is transaction-local (SET LOCAL), so it also holds behind
 * transaction-mode connection poolers, where session settings do not stick.
 */
export function transaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
    );
    return fn(tx);
  });
}

/** Closes the shared pool (scripts and tests). */
export async function closeDb(): Promise<void> {
  const state = holder.__sellerDeskDb;
  holder.__sellerDeskDb = undefined;
  if (state) await state.pool.end();
}
