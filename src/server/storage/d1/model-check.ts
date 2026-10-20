import type { AiSetupCheck } from "@/server/ai/setup-check";
import { auditEvent, installation } from "@/server/db/sqlite/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, ownerScope } from "./guards";

/** Saves a real provider-check outcome and audit together; never creates a proof from configuration. */
export function createD1ModelCheckStorage(db: D1Db) {
  return {
    async recordModelCheck(
      owner: OwnerPrincipal,
      result: AiSetupCheck,
    ): Promise<void> {
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db
          .update(installation)
          .set({
            aiCheckModel: result.proofKey,
            aiCheckOk: result.ok,
            aiCheckDetail: `${result.detail} (${result.latencyMs} ms)`.slice(
              0,
              200,
            ),
            aiCheckedAt: new Date(),
          })
          .where(sql`${installation.singleton}=1`),
        db
          .insert(auditEvent)
          .values({
            actor: "owner",
            actorId: owner.userId,
            operation: "check_ai_model",
            targetType: "installation",
            outcome: result.ok ? "ok" : "failed",
          }),
        clearBatchGuards(db, execution),
      ]);
    },
  };
}
