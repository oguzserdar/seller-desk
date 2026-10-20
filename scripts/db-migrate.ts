/**
 * Applies drizzle-kit migrations, then pins the database to APP_MODE.
 *
 * Usage: pnpm db:migrate
 * Connects directly to PostgreSQL (never through a pooler cache such as Hyperdrive).
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/server/db/client";
import { installation } from "../src/server/db/schema";
import { loadLocalEnv, requireVar } from "./lib/load-env";

loadLocalEnv();
const mode = requireVar("APP_MODE");
if (mode !== "fixture" && mode !== "sandbox") {
  console.error(`APP_MODE must be fixture or sandbox, got "${mode}".`);
  process.exit(1);
}

const { db, pool } = createDb(process.env.DATABASE_URL_UNPOOLED?.trim() || requireVar("DATABASE_URL"), 2);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(installation).values({ environment: mode }).onConflictDoNothing();
  const [row] = await db.select().from(installation);
  if (row?.environment !== mode) {
    console.error(
      `This database belongs to APP_MODE=${row?.environment}. Fixture and sandbox data must use separate databases.`,
    );
    process.exitCode = 1;
  } else {
    const [{ count }] = (await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`))
      .rows as [{ count: number }];
    console.log(`Database ready for APP_MODE=${mode} (${count} migration${count === 1 ? "" : "s"} applied).`);
  }
} finally {
  await pool.end();
}
