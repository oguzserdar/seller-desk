import { sql, type SQL } from "drizzle-orm";
import {
  blob,
  check,
  customType,
  integer,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";

/** Millisecond UTC timestamp default, matching the native D1 auth schema. */
export const nowMilliseconds = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
/** Native SQLite UUID default; independent of process memory and restarts. */
export const uuidDefault = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random() % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;
/** UUID values compare in canonical lowercase on both supported databases. */
export const uuid = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toLowerCase(),
  fromDriver: (value) => value.toLowerCase(),
});
/** Private asset bytes remain BLOBs, never encoded as public URLs or JSON. */
export const bytea = (name: string) => blob(name, { mode: "buffer" });
/** SQLite's stored boolean representation is constrained to zero or one. */
export const boolean = (name: string) => integer(name, { mode: "boolean" });
/** Timestamps use milliseconds to retain the existing lease and expiry precision. */
export const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
/** Native creation timestamp. */
export const createdAt = () =>
  ts("created_at").default(nowMilliseconds).notNull();
/** Native update timestamp, also applied by Drizzle for explicit updates. */
export const updatedAt = () =>
  ts("updated_at")
    .default(nowMilliseconds)
    .notNull()
    .$onUpdate(() => new Date());
/** Closed business vocabularies, defined by application constants rather than user input. */
export const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(", ")})`);

/**
 * SQLite affinities alone accept malformed scalar values. Match PostgreSQL's
 * integer, boolean, JSON, UUID and byte storage checks in every business table.
 */
export function scalarChecks(
  table: string,
  columns: Record<string, SQLiteColumn>,
) {
  return Object.values(columns).flatMap((column) => {
    let expression: SQL | undefined;
    const nullable = sql`${column} is null or`;
    if (column.dataType === "boolean")
      expression = sql`${nullable} (typeof(${column}) = 'integer' and ${column} in (0, 1))`;
    else if (column.dataType === "number")
      expression = sql`${nullable} (typeof(${column}) = 'integer' and ${column} between -2147483648 and 2147483647)`;
    else if (column.dataType === "date")
      expression = sql`${nullable} (typeof(${column}) = 'integer' and ${column} between -8640000000000000 and 8640000000000000)`;
    else if (column.dataType === "json")
      expression = sql`${nullable} (typeof(${column}) = 'text' and json_valid(${column}))`;
    else if (column.dataType === "buffer")
      expression = sql`${nullable} typeof(${column}) = 'blob'`;
    else if (column.columnType === "SQLiteCustomColumn")
      expression = sql`${nullable} (typeof(${column}) = 'text' and length(${column}) = 36 and substr(${column},9,1) = '-' and substr(${column},14,1) = '-' and substr(${column},19,1) = '-' and substr(${column},24,1) = '-' and length(replace(${column},'-','')) = 32 and replace(${column},'-','') not glob '*[^0-9a-f]*')`;
    return expression
      ? [check(`${table}_${column.name}_storage`, expression)]
      : [];
  });
}
