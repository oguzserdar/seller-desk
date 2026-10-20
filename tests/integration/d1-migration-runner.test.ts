import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { applyD1Migrations, assertD1Target, type D1MigrationTarget } from "../../scripts/lib/d1-runner";

function sqliteFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sqliteFiles(file) : file.endsWith(".sqlite") ? [file] : [];
  });
}

function state<T>(directory: string, read: (db: DatabaseSync) => T): T {
  // The runtime also persists its own metadata databases. Select the one with the real D1 ledger.
  const files = sqliteFiles(directory).filter((file) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare("SELECT name FROM sqlite_master WHERE name='d1_migrations'").all().length === 1; }
    finally { db.close(); }
  });
  expect(files).toHaveLength(1);
  const db = new DatabaseSync(files[0]!);
  try { return read(db); } finally { db.close(); }
}

it("requires an explicit valid destination before any maintenance run", () => {
  expect(() => assertD1Target({ mode: "remote", databaseId: "DB", accountId: "" })).toThrow(/UUID/);
  expect(() => assertD1Target({ mode: "remote", databaseId: "00000000-0000-0000-0000-000000000001", accountId: "" })).toThrow(/account ID/);
  expect(() => assertD1Target({ mode: "local", databaseId: "00000000-0000-0000-0000-000000000001", persistTo: " " })).toThrow(/directory/);
});

it("the real Wrangler runner preserves populated records, rolls back a failed file and its ledger, then resumes once", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "seller-desk-migration-test-"));
  const persistTo = path.join(root, "state");
  const target: D1MigrationTarget = { mode: "local", databaseId: "00000000-0000-0000-0000-000000000001", persistTo };
  const put = (name: string, sql: string) => writeFileSync(path.join(root, name), sql);
  const read = () => state(persistTo, (db) => ({
    shops: db.prepare("SELECT * FROM shops ORDER BY id").all(),
    orders: db.prepare("SELECT * FROM orders ORDER BY id").all(),
    ledger: db.prepare("SELECT name FROM d1_migrations ORDER BY id").all(),
  }));
  try {
    put("0001_initial.sql", `CREATE TABLE shops(id text PRIMARY KEY NOT NULL, name text NOT NULL);
      CREATE TABLE orders(id text PRIMARY KEY NOT NULL, shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE, amount integer NOT NULL CHECK(amount > 0));`);
    await applyD1Migrations(root, target);
    state(persistTo, (db) => {
      db.exec("PRAGMA foreign_keys=ON; INSERT INTO shops VALUES ('shop-a','A shop'); INSERT INTO orders VALUES ('order-a','shop-a',1250);");
    });
    const initial = read();
    expect(initial.ledger).toEqual([{ name: "0001_initial.sql" }]);

    put("0002_window.sql", "ALTER TABLE shops ADD COLUMN return_days integer NOT NULL DEFAULT 14 CHECK(return_days BETWEEN 1 AND 60);");
    await applyD1Migrations(root, target);
    const upgraded = read();
    expect(upgraded.shops).toEqual([{ id: "shop-a", name: "A shop", return_days: 14 }]);
    expect(upgraded.orders).toEqual(initial.orders);
    state(persistTo, (db) => { expect(() => db.exec("UPDATE shops SET return_days=0")).toThrow(/CHECK/); });

    put("0003_failure.sql", "CREATE TABLE should_rollback(id text); CREATE INDEX failure ON missing_table(id);");
    await expect(applyD1Migrations(root, target)).rejects.toThrow();
    expect(read()).toEqual(upgraded);
    state(persistTo, (db) => {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").all()).toEqual([]);
    });

    rmSync(path.join(root, "0003_failure.sql"));
    put("0003_lookup.sql", "CREATE INDEX order_shop ON orders(shop_id);");
    await applyD1Migrations(root, target);
    const resumed = read();
    expect(resumed.ledger).toEqual([...upgraded.ledger, { name: "0003_lookup.sql" }]);
    expect(resumed.orders).toEqual(initial.orders);
    await applyD1Migrations(root, target);
    expect(read()).toEqual(resumed);

    put("0004_unsafe.sql", "DROP TABLE shops;");
    await expect(applyD1Migrations(root, target)).rejects.toThrow(/not permitted/);
    expect(read()).toEqual(resumed);
    state(persistTo, (db) => { expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]); });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
