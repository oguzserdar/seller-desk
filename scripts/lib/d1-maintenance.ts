import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import type { D1Binding } from "../../src/server/storage/d1/client";
import { assertD1Target, type D1MigrationTarget } from "./d1-runner";
/** Official Wrangler native binding proxy with an exact destination, isolated from unrelated project logins/configuration. */
export async function openD1Maintenance(target: D1MigrationTarget) {
  assertD1Target(target);
  const root = mkdtempSync(path.join(tmpdir(), "seller-desk-d1-admin-")),
    configPath = path.join(root, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "seller-desk-db-maintenance",
      compatibility_date: "2026-10-09",
      ...(target.mode === "remote" ? { account_id: target.accountId } : {}),
      d1_databases: [
        {
          binding: "DB",
          database_name: "seller-desk-maintenance",
          database_id: target.databaseId,
          ...(target.mode === "remote" ? { remote: true } : {}),
        },
      ],
    }),
    { mode: 0o600 },
  );
  try {
    const proxy = await getPlatformProxy<{ DB: D1Binding }>({
      configPath,
      envFiles: [],
      remoteBindings: target.mode === "remote",
      persist:
        target.mode === "local"
          ? { path: path.resolve(target.persistTo, "v3") }
          : false,
    });
    return {
      binding: proxy.env.DB,
      async close() {
        try {
          await proxy.dispose();
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
