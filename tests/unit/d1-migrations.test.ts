import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertAdditiveD1Migration, readD1Migrations } from "../../scripts/lib/d1-migrations";

const roots: string[] = [];
const directory = () => {
  const root = mkdtempSync(path.join(tmpdir(), "d1-migrations-"));
  roots.push(root);
  return root;
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("D1 migration preservation guard", () => {
  it("rejects the generated parent rebuild that silently cascades child deletion", () => {
    const generated = `PRAGMA foreign_keys=OFF;
      CREATE TABLE __new_shop(id text PRIMARY KEY, days integer CHECK(days between 1 and 60));
      INSERT INTO __new_shop SELECT * FROM shop;
      DROP TABLE shop;
      ALTER TABLE __new_shop RENAME TO shop;
      PRAGMA foreign_keys=ON;`;
    expect(() => assertAdditiveD1Migration(generated, "0002_window.sql")).toThrow(/0002_window.sql.*statement 1.*PRAGMA/i);
    expect(() => assertAdditiveD1Migration(generated.replace("PRAGMA foreign_keys=OFF;", "PRAGMA defer_foreign_keys=ON;"))).toThrow(/PRAGMA/);
  });

  it.each([
    "DROP TABLE shop;", "DROP INDEX lookup;", "ALTER TABLE shop RENAME TO old_shop;",
    "ALTER TABLE shop DROP COLUMN name;", "DELETE FROM shop;", "UPDATE sqlite_schema SET sql='';",
    "INSERT INTO shop VALUES ('changed');", "REPLACE INTO shop VALUES ('changed');",
    "CREATE TRIGGER erase AFTER INSERT ON shop BEGIN DELETE FROM orders; END;",
    "ATTACH DATABASE ':memory:' AS other;", "VACUUM;", "BEGIN;", "PRAGMA writable_schema=ON;",
  ])("blocks changes without a migration-specific preservation proof: %s", (sql) => {
    expect(() => assertAdditiveD1Migration(sql)).toThrow(/not permitted/i);
  });

  it("accepts additive schema SQL without interpreting quoted content as commands", () => {
    expect(() => assertAdditiveD1Migration(`-- DROP TABLE is only a comment
      CREATE TABLE "shop" (id text PRIMARY KEY, note text DEFAULT 'It''s safe; DROP TABLE shop;');
      /* generated separator */ CREATE UNIQUE INDEX \`shop_id\` ON "shop" (id);
      ALTER TABLE [shop] ADD COLUMN "label" text DEFAULT 'hello; world';
      ALTER TABLE shop ADD enabled integer NOT NULL DEFAULT 1;
    `)).not.toThrow();
  });

  it("checks every statement, including a command after an apparently safe one", () => {
    expect(() => assertAdditiveD1Migration("CREATE TABLE shop(id text); /* hidden */ DROP TABLE orders;")).toThrow(/statement 2.*DROP/i);
    expect(() => assertAdditiveD1Migration('"CREATE" "TABLE" x(id);')).toThrow();
    expect(() => assertAdditiveD1Migration('ALTER TABLE shop "ADD" name text;')).toThrow();
  });

  it.each(["CREATE TABLE x(note text DEFAULT 'unfinished);", "/* unfinished", 'CREATE TABLE "unfinished', "\0CREATE TABLE x(id);"])("rejects malformed lexical input", (sql) => {
    expect(() => assertAdditiveD1Migration(sql)).toThrow();
  });

  it("reads ordered top-level migrations and refuses missing, duplicate or linked SQL", () => {
    const root = directory();
    expect(() => readD1Migrations(root)).toThrow(/no SQL migrations/i);
    mkdirSync(path.join(root, "meta"));
    writeFileSync(path.join(root, "0002_index.sql"), "CREATE INDEX lookup ON shop(id);");
    writeFileSync(path.join(root, "0001_shop.sql"), "CREATE TABLE shop(id text);");
    expect(readD1Migrations(root).map((file) => file.name)).toEqual(["0001_shop.sql", "0002_index.sql"]);
    writeFileSync(path.join(root, "0002_duplicate.sql"), "CREATE TABLE other(id text);");
    expect(() => readD1Migrations(root)).toThrow(/duplicate migration number/i);
    rmSync(path.join(root, "0002_duplicate.sql"));
    symlinkSync(path.join(root, "0001_shop.sql"), path.join(root, "0003_link.sql"));
    expect(() => readD1Migrations(root)).toThrow(/regular file/i);
  });

  it("validates SQL before returning any files to a migration runner", () => {
    const root = directory();
    writeFileSync(path.join(root, "0001_shop.sql"), "CREATE TABLE shop(id text);");
    writeFileSync(path.join(root, "0002_unsafe.sql"), "DROP TABLE shop;");
    expect(() => readD1Migrations(root)).toThrow(/0002_unsafe.sql/);
    rmSync(path.join(root, "0002_unsafe.sql"));
    writeFileSync(path.join(root, "unversioned.sql"), "CREATE TABLE other(id text);");
    expect(() => readD1Migrations(root)).toThrow(/numbered/i);
  });
});
