import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { TASK_STATES, TASK_TYPES } from "../constants";
import type { ProposalArgs, ProposalResult, TaskDetails } from "../types";
import {
  createdAt,
  inList,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";
import { orders } from "./payments";
import { digitalAsset, seller } from "./shop";

/** Fulfillment task records in the D1 dialect. */
export const fulfillmentTask = sqliteTable(
  "fulfillment_task",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type", { enum: TASK_TYPES }).notNull(),
    state: text("state", { enum: TASK_STATES }).notNull(),
    revision: integer("revision").default(1).notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    lastError: text("last_error"),
    details: text("details", { mode: "json" })
      .$type<TaskDetails>()
      .default({})
      .notNull(),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("fulfillment_task", t),
    uniqueIndex("fulfillment_task_order_type_key").on(t.orderId, t.type),
    index("fulfillment_task_state_idx").on(t.state),
    check("fulfillment_task_type_valid", inList("type", TASK_TYPES)),
    check("fulfillment_task_state_valid", inList("state", TASK_STATES)),
  ],
);

/** Access grant records in the D1 dialect. */
export const accessGrant = sqliteTable(
  "access_grant",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => digitalAsset.id, { onDelete: "restrict" }),
    capabilityHash: text("capability_hash").notNull(),
    state: text("state", { enum: ["active", "revoked"] }).notNull(),
    expiresAt: ts("expires_at").notNull(),
    downloadCount: integer("download_count").default(0).notNull(),
    lastDownloadAt: ts("last_download_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("access_grant", t),
    uniqueIndex("access_grant_order_asset_key").on(t.orderId, t.assetId),
    uniqueIndex("access_grant_capability_key").on(t.capabilityHash),
    check("access_grant_state_valid", inList("state", ["active", "revoked"])),
  ],
);

/** Owner proposal records in the D1 dialect. */
export const ownerProposal = sqliteTable(
  "owner_proposal",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => seller.id, { onDelete: "cascade" }),
    verb: text("verb").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    args: text("args", { mode: "json" }).$type<ProposalArgs>().notNull(),
    argsHash: text("args_hash").notNull(),
    summary: text("summary").notNull(),
    state: text("state", {
      enum: ["pending", "executed", "rejected", "expired", "failed"],
    }).notNull(),
    result: text("result", { mode: "json" }).$type<ProposalResult>(),
    expiresAt: ts("expires_at").notNull(),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("owner_proposal", t),
    index("owner_proposal_state_idx").on(t.state),
    check(
      "owner_proposal_state_valid",
      inList("state", ["pending", "executed", "rejected", "expired", "failed"]),
    ),
  ],
);
