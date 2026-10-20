/**
 * Runs once before the suite: rebuilds the test database from the committed
 * migrations, exactly as `pnpm db:migrate` would, and pins it to fixture mode.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../../src/server/db/client";
import { installation } from "../../src/server/db/schema";
import { assertTestDatabase, TEST_DATABASE_URL } from "./test-env";

export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const { db, pool } = createDb(TEST_DATABASE_URL, 1);
  try {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db.insert(installation).values({ environment: "fixture" });
  } finally {
    await pool.end();
  }
}
