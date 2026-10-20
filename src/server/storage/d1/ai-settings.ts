import { auditEvent, installation } from "@/server/db/sqlite/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, ownerScope } from "./guards";

/** The sealed AI connection on the installation row, with its audit written in the same batch. */
export function createD1AiSettingsStorage(db: D1Db) {
  return {
    async readSealedAiSettings(): Promise<string | null> {
      const [row] = await db
        .select({ sealed: installation.aiSettingsSealed })
        .from(installation)
        .where(sql`${installation.singleton}=1`);
      return row?.sealed ?? null;
    },
    async writeSealedAiSettings(
      owner: OwnerPrincipal,
      sealed: string | null,
      details: Record<string, string>,
    ): Promise<void> {
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db
          .update(installation)
          .set({ aiSettingsSealed: sealed })
          .where(sql`${installation.singleton}=1`),
        db.insert(auditEvent).values({
          actor: "owner",
          actorId: owner.userId,
          operation: sealed ? "save_ai_connection" : "remove_ai_connection",
          targetType: "installation",
          outcome: "ok",
          details,
        }),
        clearBatchGuards(db, execution),
      ]);
    },
  };
}
