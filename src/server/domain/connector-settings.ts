/**
 * Who answers customers' waiting questions: whether the assistant drafts the owner's reply, and whether
 * connected AI apps may answer as the owner.
 *
 * Drafting is on by default and connected apps are off until the owner turns them on in Setup. The connector reads it on every call, so turning it
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

/** True when the assistant drafts the owner's reply to a waiting question (the owner still sends it). */
export async function assistantDraftsAnswers(): Promise<boolean> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.connectorSettings.readAssistantDraftsAnswers();
  const [row] = await getDb().select({ on: installation.assistantDraftsAnswers }).from(installation);
  return row?.on ?? true;
}

/**
 * Chooses between "only I answer" (off) and "my assistant drafts, I approve" (on), with an audit entry.
 *
 * @param owner - The signed-in owner (never the demo visitor; the action refuses it first)
 * @param on - True lets the assistant draft replies for the owner to send
 */
export async function setAssistantDraftsAnswers(owner: OwnerPrincipal, on: boolean): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.connectorSettings.writeAssistantDraftsAnswers(owner, on);
  await transaction(getDb(), async (tx) => {
    await tx.update(installation).set({ assistantDraftsAnswers: on });
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: on ? "assistant_drafts_answers" : "owner_writes_answers",
      targetType: "installation",
      outcome: "ok",
    });
  });
}
