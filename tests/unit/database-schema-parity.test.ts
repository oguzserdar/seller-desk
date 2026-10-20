import * as pg from "@/server/db/schema";
import * as d1 from "@/server/db/sqlite/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import {
  SQLiteTable,
  getTableConfig as sqliteConfig,
} from "drizzle-orm/sqlite-core";
import { expect, expectTypeOf, it } from "vitest";

type PgRows = {
  [K in keyof typeof pg as (typeof pg)[K] extends PgTable
    ? K
    : never]: (typeof pg)[K] extends PgTable
    ? (typeof pg)[K]["$inferSelect"]
    : never;
};
type D1Rows = {
  [K in keyof typeof d1 as K extends "storageSequence" | "storageIdentity"
    ? never
    : (typeof d1)[K] extends SQLiteTable
      ? K
      : never]: (typeof d1)[K] extends SQLiteTable
    ? (typeof d1)[K]["$inferSelect"]
    : never;
};

it("both native schemas expose exactly the same 44 logical row types", () => {
  expectTypeOf<D1Rows>().toEqualTypeOf<PgRows>();
  const pgTables = Object.values(pg).filter((value) => is(value, PgTable));
  const d1Tables = Object.values(d1).filter(
    (value) =>
      is(value, SQLiteTable) &&
      !["storage_sequence", "storage_identity"].includes(getTableName(value)),
  );
  expect(pgTables).toHaveLength(44);
  expect(d1Tables.map(getTableName).sort()).toEqual(
    pgTables.map(getTableName).sort(),
  );
  for (const table of pgTables) {
    const other = d1Tables.find(
      (candidate) => getTableName(candidate) === getTableName(table),
    )!;
    const columns = (input: PgTable | SQLiteTable) =>
      Object.entries(getTableColumns(input)).map(([key, col]) => ({
        key,
        name: col.name,
        notNull: col.notNull,
        primary: col.primary,
      }));
    expect(columns(other), getTableName(table)).toEqual(columns(table));
    const a = pgConfig(table),
      b = sqliteConfig(other);
    expect(
      a.checks
        .map((c) => c.name)
        .filter((name) => !b.checks.some((c) => c.name === name)),
      `${a.name} missing business checks`,
    ).toEqual([]);
    const refs = (
      config: ReturnType<typeof pgConfig> | ReturnType<typeof sqliteConfig>,
    ) =>
      config.foreignKeys
        .map((fk) => {
          const ref = fk.reference();
          return {
            columns: ref.columns.map((c) => c.name),
            foreignTable: getTableName(ref.foreignTable),
            foreignColumns: ref.foreignColumns.map((c) => c.name),
            onDelete: fk.onDelete,
          };
        })
        .sort((x, y) => x.columns.join().localeCompare(y.columns.join()));
    expect(refs(b), `${a.name} foreign keys`).toEqual(refs(a));
    const indexes = (
      config: ReturnType<typeof pgConfig> | ReturnType<typeof sqliteConfig>,
    ) =>
      config.indexes
        .map((index) => ({
          name: index.config.name,
          unique: index.config.unique,
          columns: index.config.columns.map((col) =>
            "name" in col ? col.name : null,
          ),
        }))
        .sort((x, y) => String(x.name).localeCompare(String(y.name)));
    // Better Auth emits unique columns as native SQLite unique indexes.
    const existing = indexes(a);
    expect(
      indexes(b).filter((index) => existing.some((i) => i.name === index.name)),
      `${a.name} indexes`,
    ).toEqual(existing);
  }
});
