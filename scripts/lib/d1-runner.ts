import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readD1Migrations, type D1Migration } from "./d1-migrations";

/** Explicit destination for a D1 maintenance command, never inferred from a Worker project. */
export type D1MigrationTarget =
  | { mode: "local"; databaseId: string; persistTo: string }
  | { mode: "remote"; databaseId: string; accountId: string };

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const wranglerPackage = require("wrangler/package.json") as { bin: { wrangler: string } };
const wranglerBin = path.resolve(path.dirname(require.resolve("wrangler/package.json")), wranglerPackage.bin.wrangler);

/** Validates a maintenance destination without reading a global login or project configuration. */
export function assertD1Target(target: D1MigrationTarget): void {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target.databaseId)) throw new Error("Provide the exact D1 database UUID.");
  if (target.mode === "remote" && !/^[a-f0-9]{32}$/i.test(target.accountId)) throw new Error("Provide the exact Cloudflare account ID for a remote migration.");
  if (target.mode === "local" && !target.persistTo.trim()) throw new Error("Provide a dedicated local D1 state directory.");
}

/**
 * Checks all SQL first, then applies the same bytes from a private temporary snapshot.
 * Wrangler owns the single d1_migrations ledger. No Worker is uploaded or provisioned.
 */
export async function applyD1Migrations(directory: string, target: D1MigrationTarget): Promise<{ migrations: D1Migration[]; output: string }> {
  assertD1Target(target);
  const migrations = readD1Migrations(directory);
  const root = mkdtempSync(path.join(tmpdir(), "seller-desk-d1-migrate-"));
  try {
    const staged = path.join(root, "migrations");
    mkdirSync(staged, { mode: 0o700 });
    for (const migration of migrations) writeFileSync(path.join(staged, migration.name), migration.sql, { mode: 0o600 });
    const config = path.join(root, "wrangler.json");
    writeFileSync(config, JSON.stringify({
      name: "seller-desk-db-maintenance", compatibility_date: "2026-10-09",
      ...(target.mode === "remote" ? { account_id: target.accountId } : {}),
      d1_databases: [{ binding: "DB", database_name: "seller-desk-maintenance", database_id: target.databaseId, migrations_dir: staged }],
    }), { mode: 0o600 });
    const args = ["d1", "migrations", "apply", "DB", "--config", config,
      ...(target.mode === "local" ? ["--local", "--persist-to", path.resolve(target.persistTo)] : ["--remote"])];
    const result = await execute(process.execPath, [wranglerBin, ...args], {
      cwd: root, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    });
    return { migrations, output: result.stdout + result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
