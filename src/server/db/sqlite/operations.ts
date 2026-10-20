import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ENVIRONMENTS } from "../constants";
import type { AuditDetails, WebhookSummary } from "../types";
import {
  createdAt,
  inList,
  nowMilliseconds,
  scalarChecks,
  ts,
  updatedAt,
  uuid,
  uuidDefault,
} from "./columns";

/** Operation key records in the D1 dialect. */
export const operationKey = sqliteTable(
  "operation_key",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state", {
      enum: ["in_progress", "completed", "failed"],
    }).notNull(),
    result: text("result", { mode: "json" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("operation_key", t),
    primaryKey({ columns: [t.scope, t.key] }),
    check(
      "operation_key_state_valid",
      inList("state", ["in_progress", "completed", "failed"]),
    ),
  ],
);

/** Webhook event records in the D1 dialect. */
export const webhookEvent = sqliteTable(
  "webhook_event",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    environment: text("environment", { enum: ENVIRONMENTS }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    providerOrderId: text("provider_order_id"),
    summary: text("summary", { mode: "json" })
      .$type<WebhookSummary>()
      .notNull(),
    processingState: text("processing_state", {
      enum: ["received", "processed", "failed", "ignored"],
    }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: ts("next_attempt_at").default(nowMilliseconds).notNull(),
    lastError: text("last_error"),
    receivedAt: ts("received_at").default(nowMilliseconds).notNull(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    ...scalarChecks("webhook_event", t),
    uniqueIndex("webhook_event_provider_key").on(
      t.environment,
      t.providerEventId,
    ),
    index("webhook_event_due_idx").on(t.processingState, t.nextAttemptAt),
    check(
      "webhook_event_state_valid",
      inList("processing_state", [
        "received",
        "processed",
        "failed",
        "ignored",
      ]),
    ),
  ],
);

/** Job records in the D1 dialect. */
export const job = sqliteTable(
  "job",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    kind: text("kind", {
      enum: ["reconcile_payment", "grant_access"],
    }).notNull(),
    targetId: uuid("target_id").notNull(),
    state: text("state", { enum: ["pending", "done", "failed"] }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    runAfter: ts("run_after").default(nowMilliseconds).notNull(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...scalarChecks("job", t),
    uniqueIndex("job_kind_target_key").on(t.kind, t.targetId),
    index("job_due_idx").on(t.state, t.runAfter),
    check(
      "job_kind_valid",
      inList("kind", ["reconcile_payment", "grant_access"]),
    ),
    check("job_state_valid", inList("state", ["pending", "done", "failed"])),
  ],
);

/** Audit event records in the D1 dialect. */
export const auditEvent = sqliteTable(
  "audit_event",
  {
    id: uuid("id").default(uuidDefault).primaryKey(),
    actor: text("actor", {
      enum: ["owner", "buyer", "system", "paypal", "job", "assistant"],
    }).notNull(),
    actorId: text("actor_id"),
    operation: text("operation").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome", {
      enum: ["ok", "denied", "failed", "noop"],
    }).notNull(),
    details: text("details", { mode: "json" })
      .$type<AuditDetails>()
      .default({})
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...scalarChecks("audit_event", t),
    index("audit_event_target_idx").on(t.targetId),
    index("audit_event_created_idx").on(t.createdAt),
  ],
);

/** Usage bucket records in the D1 dialect. */
export const usageBucket = sqliteTable(
  "usage_bucket",
  {
    feature: text("feature").notNull(),
    principal: text("principal").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").default(0).notNull(),
  },
  (t) => [
    ...scalarChecks("usage_bucket", t),
    primaryKey({ columns: [t.feature, t.principal, t.windowStart] }),
  ],
);
