import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Durable native identity counters, advanced only inside the consuming write batch. */
export const storageSequence = sqliteTable(
  "storage_sequence",
  {
    name: text("name", {
      enum: ["message", "owner_message", "orders"],
    }).primaryKey(),
    value: integer("value").notNull(),
  },
  (t) => [
    check(
      "storage_sequence_name_valid",
      sql`${t.name} in ('message', 'owner_message', 'orders')`,
    ),
    check(
      "storage_sequence_value_valid",
      sql`typeof(${t.value}) = 'integer' and ${t.value} between 1 and 2147483647`,
    ),
  ],
);

/** Stable installation identity proves a simulation target differs from its source binding. */
export const storageIdentity = sqliteTable(
  "storage_identity",
  {
    singleton: integer("singleton").primaryKey().default(1),
    id: text("id").notNull().unique(),
  },
  (t) => [check("storage_identity_singleton", sql`${t.singleton}=1`)],
);
