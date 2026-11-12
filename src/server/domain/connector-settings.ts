/**
 * Whether the owner lets connected AI apps answer customers' waiting questions as them.
 *
 * Off until the owner turns it on in Setup. The connector reads it on every call, so turning it
 * off stops the next answer at once. Every change is audited.
 */
import { getDb, transaction } from "@/server/db/client";
import { installation } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { recordAudit } from "./audit";
import type { OwnerPrincipal } from "./principal";

/** True only when the owner has turned on answering for connected AI apps. */
export async function connectorMayAnswer(): Promise<boolean> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.connectorSettings.readConnectorMayAnswer();
  const [row] = await getDb().select({ allowed: installation.connectorMayAnswer }).from(installation);
  return row?.allowed ?? false;
}

/**
 * Turns answering by connected AI apps on or off, with an audit entry.
 *
 * @param owner - The signed-in owner (never the demo visitor; the action refuses it first)
 * @param allowed - True lets connected apps answer waiting questions as the owner
 */
export async function setConnectorMayAnswer(owner: OwnerPrincipal, allowed: boolean): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.connectorSettings.writeConnectorMayAnswer(owner, allowed);
  await transaction(getDb(), async (tx) => {
    await tx.update(installation).set({ connectorMayAnswer: allowed });
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: allowed ? "allow_connector_answers" : "stop_connector_answers",
      targetType: "installation",
      outcome: "ok",
    });
  });
}
