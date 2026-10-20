/**
 * The app must connect through transaction-mode poolers (PgBouncer, Supavisor,
 * Hyperdrive). Those refuse unknown settings in the connection's startup
 * message, so none may travel there; every transaction sets its own limit.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, STATEMENT_TIMEOUT_MS, transaction } from "@/server/db/client";
import { TEST_DATABASE_URL } from "../support/test-env";

describe("database connections", () => {
  it("send no settings in the startup message, so poolers accept them", async () => {
    const { pool } = createDb(TEST_DATABASE_URL, 1);
    try {
      const options = (pool as unknown as { options: Record<string, unknown> }).options;
      expect(options.statement_timeout).toBeUndefined();
      expect(options.lock_timeout).toBeUndefined();
      expect(options.options).toBeUndefined();
    } finally {
      await pool.end();
    }
  });

  it("limit every statement in a transaction, and leave the connection clean afterwards", async () => {
    // One connection, so the second read is on the same session as the transaction.
    const { pool, db } = createDb(TEST_DATABASE_URL, 1);
    try {
      const inside = (await transaction(db, async (tx) => (await tx.execute(sql`show statement_timeout`)).rows[0])) as { statement_timeout: string };
      expect(inside.statement_timeout).toBe(`${STATEMENT_TIMEOUT_MS / 1000}s`);
      const after = (await db.execute(sql`show statement_timeout`)).rows[0] as { statement_timeout: string };
      expect(after.statement_timeout).not.toBe(inside.statement_timeout);
    } finally {
      await pool.end();
    }
  });
});
