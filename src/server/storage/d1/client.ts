import * as schema from "@/server/db/sqlite/schema";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

/** Native binding supplied by Workers, or by the same workerd runtime in tests. */
export type D1Binding = D1Database;
/** Typed D1 queries, always scoped to the explicitly supplied installation binding. */
export type D1Db = DrizzleD1Database<typeof schema>;
/** Creates a D1 client without opening PostgreSQL or retaining a global binding. */
export function createD1Db(binding: D1Binding): D1Db {
  return drizzle(binding, { schema });
}
