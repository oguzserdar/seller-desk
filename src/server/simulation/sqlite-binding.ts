/** The D1 query protocol used by the pinned Drizzle driver, backed by an isolated SQLite engine. */
import type { D1Database } from "@cloudflare/workers-types";

/** JSON-safe SQLite values; blobs are explicitly tagged across the internal Worker binding. */
export type TrialValue = string | number | null | { bytes: number[] };
/** A prepared statement, never supplied by a browser or model. */
export type TrialQuery = { sql: string; values: TrialValue[] };
/** Ordered columns preserve Drizzle's positional mapping, including duplicate column names. */
export type TrialRows = { columns: string[]; rows: TrialValue[][]; changes: number; lastRowId: number };
/** The engine executes a batch atomically; an exception must roll back the whole batch. */
export type TrialExecutor = (queries: TrialQuery[], atomic: boolean) => Promise<TrialRows[]>;

/** Encodes bound and returned blobs without converting private bytes to text. */
export function encodeTrialValue(value: unknown): TrialValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (value instanceof ArrayBuffer) return { bytes: [...new Uint8Array(value)] };
  if (ArrayBuffer.isView(value)) return { bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)] };
  if (Array.isArray(value) && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return { bytes: value };
  throw new Error("Unsupported SQLite value.");
}
/** Restores native bytes for SQLite bindings and Drizzle's blob decoder. */
export function decodeTrialValue(value: TrialValue): string | number | null | Uint8Array {
  return typeof value === "object" && value !== null ? new Uint8Array(value.bytes) : value;
}

/** Adapts the actual SQLite engine to prepare/bind/all/raw/run/batch used by Drizzle 0.45.3. */
export function createTrialBinding(execute: TrialExecutor): D1Database {
  class Statement {
    constructor(readonly sql: string, readonly values: TrialValue[] = []) {}
    bind(...values: unknown[]) { return new Statement(this.sql, values.map(encodeTrialValue)); }
    async query() { return (await execute([{ sql: this.sql, values: this.values }], false))[0]!; }
    async raw(options?: { columnNames?: boolean }) {
      const data = await this.query(), rows = data.rows.map(row => row.map(decodeTrialValue));
      return options?.columnNames ? [data.columns, ...rows] : rows;
    }
    async all() { return result(await this.query()); }
    async run() { return this.all(); }
    async first(column?: string) {
      const row = (await this.all()).results[0];
      if (column && row && !(column in row)) throw new Error("Unknown SQLite result column.");
      return column ? row?.[column] ?? null : row ?? null;
    }
  }
  function result(data: TrialRows) {
    return {
      success: true as const,
      results: data.rows.map(row => Object.fromEntries(data.columns.map((name, i) => [name, decodeTrialValue(row[i]!)]))),
      meta: { duration: 0, size_after: 0, rows_read: data.rows.length, rows_written: data.changes, changes: data.changes, last_row_id: data.lastRowId, changed_db: data.changes > 0 },
    };
  }
  // This is a query-protocol adapter, not a remote D1 binding. Replica sessions,
  // dump and exec are deliberately absent. Drizzle's pinned driver uses only
  // these methods; the integration tests execute migrations and real actors.
  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      if (statements.some(s => !(s instanceof Statement))) throw new Error("Foreign SQLite statement.");
      return (await execute(statements.map(s => ({ sql: s.sql, values: s.values })), true)).map(result);
    },
  } as unknown as D1Database;
}
