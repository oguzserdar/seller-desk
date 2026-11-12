import { auditEvent, installation } from "@/server/db/sqlite/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, ownerScope } from "./guards";

/** Whether connected AI apps may answer customers, on the installation row, with its audit in the same batch. */
export function createD1ConnectorSettings(db: D1Db) {
  return {
    async readConnectorMayAnswer(): Promise<boolean> {
      const [row] = await db
        .select({ allowed: installation.connectorMayAnswer })
        .from(installation)
        .where(sql`${installation.singleton}=1`);
      return row?.allowed ?? false;
    },
    async writeConnectorMayAnswer(owner: OwnerPrincipal, allowed: boolean): Promise<void> {
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db
          .update(installation)
          .set({ connectorMayAnswer: allowed })
          .where(sql`${installation.singleton}=1`),
        db.insert(auditEvent).values({
          actor: "owner",
          actorId: owner.userId,
          operation: allowed ? "allow_connector_answers" : "stop_connector_answers",
          targetType: "installation",
          outcome: "ok",
        }),
        clearBatchGuards(db, execution),
      ]);
    },
  };
}
