import type { Queryable } from "@/server/db/client";
import { auditEvent } from "@/server/db/schema";
import type { AuditDetails } from "@/server/db/types";

export type AuditEntry = {
  actor: "owner" | "buyer" | "system" | "paypal" | "job" | "assistant";
  actorId?: string | null;
  operation: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "ok" | "denied" | "failed" | "noop";
  details?: AuditDetails;
};

/** Appends one operation record. Callers pass only ids and outcomes, never secrets or payer details. */
export async function recordAudit(q: Queryable, entry: AuditEntry): Promise<void> {
  await q.insert(auditEvent).values({
    actor: entry.actor,
    actorId: entry.actorId ?? null,
    operation: entry.operation,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    outcome: entry.outcome,
    details: entry.details ?? {},
  });
}
