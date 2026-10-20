import { sql } from "drizzle-orm";
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAt, inList, scalarChecks, ts, uuid } from "./columns";
import { seller } from "./shop";

/** Simulation run records in the D1 dialect. */
export const simulationRun = sqliteTable(
  "simulation_run",
  {
    id: uuid("id").primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "restrict" }),
    input: text("input", { mode: "json" })
      .$type<import("@/lib/simulation").SimulationInput>()
      .notNull(),
    snapshot: text("snapshot", { mode: "json" })
      .$type<import("@/server/simulation/snapshot").SimulationShopSnapshot>()
      .notNull(),
    change: text("change", { mode: "json" }).$type<
      import("@/lib/simulation").SimulationChange
    >(),
    generator: text("generator").notNull(),
    state: text("state", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    currentResult: text("current_result", { mode: "json" }).$type<
      import("@/lib/simulation").SimulationSideResult
    >(),
    proposedResult: text("proposed_result", { mode: "json" }).$type<
      import("@/lib/simulation").SimulationSideResult
    >(),
    failure: text("failure"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    ...scalarChecks("simulation_run", t),
    index("simulation_run_seller_created_idx").on(t.sellerId, t.createdAt),
    uniqueIndex("simulation_run_one_running")
      .on(t.sellerId)
      .where(sql`${t.state} = 'running'`),
    check(
      "simulation_run_state_valid",
      inList("state", ["running", "completed", "failed"]),
    ),
    check(
      "simulation_run_ordered_results",
      sql`${t.proposedResult} is null or ${t.currentResult} is not null`,
    ),
    check(
      "simulation_run_completed_results",
      sql`${t.state} <> 'completed' or (${t.currentResult} is not null and (${t.change} is null or ${t.proposedResult} is not null))`,
    ),
  ],
);
