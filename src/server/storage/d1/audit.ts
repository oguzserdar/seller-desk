import { auditEvent } from "@/server/db/sqlite/schema";
import type { AuditEntry } from "@/server/domain/audit";
import type { D1Db } from "./client";

/** Appends trusted server metadata; compound business operations include their audit inside their batch. */
export function createD1AuditStorage(db: D1Db) {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await db
        .insert(auditEvent)
        .values({
          actor: entry.actor,
          actorId: entry.actorId ?? null,
          operation: entry.operation,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          outcome: entry.outcome,
          details: entry.details ?? {},
        });
    },
  };
}
