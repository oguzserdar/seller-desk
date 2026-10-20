import { getStorage } from "@/server/storage";
/**
 * Records Setup's live test of the configured AI model on the installation, so
 * readiness can distinguish configuration from a real tool/output check.
 */
import type { AiSetupCheck } from "@/server/ai/setup-check";
import { getDb } from "@/server/db/client";
import { installation } from "@/server/db/schema";
import { sql } from "drizzle-orm";
import { recordAudit } from "./audit";
import type { OwnerPrincipal } from "./principal";

/** Stores the bounded result of the owner's real connection check, without model text or credentials. */
export async function recordModelCheck(
  owner: OwnerPrincipal,
  result: AiSetupCheck,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.modelCheck.recordModelCheck(owner, result);

  const db = getDb();
  await db.update(installation).set({
    aiCheckModel: result.proofKey,
    aiCheckOk: result.ok,
    aiCheckDetail: `${result.detail} (${result.latencyMs} ms)`.slice(0, 200),
    aiCheckedAt: sql`now()`,
  });
  await recordAudit(db, {
    actor: "owner",
    actorId: owner.userId,
    operation: "check_ai_model",
    targetType: "installation",
    outcome: result.ok ? "ok" : "failed",
  });
}
