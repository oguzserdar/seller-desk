import { getStorage } from "@/server/storage";
/** Owner-only comparisons of saved directions. No customer or commerce record is changed. */
import { PreviewAnswer } from "@/lib/learning-preview";
import {
  ProcedurePreviewInput,
  type ProcedurePreviewView,
} from "@/lib/procedure-preview";
import { getDb, transaction, type Queryable } from "@/server/db/client";
import {
  assistantProcedure,
  assistantProcedureVersion,
  procedurePreview,
  seller,
} from "@/server/db/schema";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, notFound } from "./errors";
import { publicPreviewFacts } from "./learning-review";
import type { OwnerPrincipal } from "./principal";

/** Internal snapshots stay server-side; reports expose only the wording and generated replies. */
export type ProcedurePreviewRow = typeof procedurePreview.$inferSelect;
async function ownerScope(owner: OwnerPrincipal, db: Queryable, lock = false) {
  const query = db
    .select()
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [shop] = await (lock ? query.for("update") : query);
  if (!shop) throw notFound("shop");
  return shop;
}

/** Pins published and proposed wording atomically; exact retries do not run the model again. */
export async function claimProcedurePreview(
  owner: OwnerPrincipal,
  raw: ProcedurePreviewInput,
  generator: string,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.claimProcedurePreview(owner, raw, generator);

  const input = ProcedurePreviewInput.parse(raw);
  z.string().min(1).max(200).parse(generator);
  return transaction(getDb(), async (tx) => {
    const shop = await ownerScope(owner, tx, true);
    const [existing] = await tx
      .select()
      .from(procedurePreview)
      .where(eq(procedurePreview.id, input.requestId));
    if (existing) {
      if (existing.sellerId !== owner.sellerId) throw notFound("preview");
      if (
        existing.procedureId !== input.procedureId ||
        existing.revision !== input.expectedRevision ||
        existing.question !== input.question
      )
        throw conflict(
          "This preview request already names another question or version.",
        );
      return {
        created: false,
        row: existing,
        dailyLimit: shop.sellerDailyAiTurns,
      };
    }
    const [draft] = await tx
      .select()
      .from(assistantProcedure)
      .where(
        and(
          eq(assistantProcedure.id, input.procedureId),
          eq(assistantProcedure.sellerId, owner.sellerId),
        ),
      )
      .for("update");
    if (!draft) throw notFound("instruction");
    if (draft.archived || draft.revision !== input.expectedRevision)
      throw conflict(
        "This instruction changed. Reload the saved wording before comparing replies.",
      );
    const published = await tx
      .select({
        id: assistantProcedure.id,
        content: assistantProcedureVersion.content,
      })
      .from(assistantProcedure)
      .innerJoin(
        assistantProcedureVersion,
        and(
          eq(assistantProcedureVersion.procedureId, assistantProcedure.id),
          eq(assistantProcedureVersion.sellerId, assistantProcedure.sellerId),
          eq(
            assistantProcedureVersion.revision,
            assistantProcedure.publishedRevision,
          ),
        ),
      )
      .where(
        and(
          eq(assistantProcedure.sellerId, owner.sellerId),
          eq(assistantProcedure.archived, false),
          isNotNull(assistantProcedure.publishedRevision),
        ),
      )
      .orderBy(asc(assistantProcedure.createdAt));
    const proposed = published.some((row) => row.id === draft.id)
      ? published.map((row) =>
          row.id === draft.id ? draft.content : row.content,
        )
      : [...published.map((row) => row.content), draft.content];
    await tx
      .update(procedurePreview)
      .set({
        state: "failed",
        failure: "This comparison did not finish. Any completed reply is kept.",
      })
      .where(
        and(
          eq(procedurePreview.sellerId, owner.sellerId),
          eq(procedurePreview.state, "running"),
          sql`${procedurePreview.expiresAt} <= now()`,
        ),
      );
    const [active] = await tx
      .select({ id: procedurePreview.id })
      .from(procedurePreview)
      .where(
        and(
          eq(procedurePreview.sellerId, owner.sellerId),
          eq(procedurePreview.state, "running"),
        ),
      );
    if (active)
      throw conflict(
        "A reply comparison is already running. Wait for it to finish.",
      );
    const [row] = await tx
      .insert(procedurePreview)
      .values({
        id: input.requestId,
        sellerId: owner.sellerId,
        procedureId: draft.id,
        revision: draft.revision,
        publishedRevision: draft.publishedRevision,
        question: input.question,
        wording: draft.content,
        facts: await publicPreviewFacts(owner, tx),
        currentInstructions: published.map((row) => row.content),
        proposedInstructions: proposed,
        generator,
        expiresAt: new Date(Date.now() + 120_000),
      })
      .returning();
    if (!row) throw new Error("preview insert returned nothing");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "procedure_preview.start",
      targetType: "procedure_preview",
      targetId: row.id,
      outcome: "ok",
      details: { procedureId: draft.id, revision: draft.revision },
    });
    return { created: true, row, dailyLimit: shop.sellerDailyAiTurns };
  });
}

/** Saves each real reply once, in order, without erasing a partial result after failure. */
export async function saveProcedurePreviewAnswer(
  owner: OwnerPrincipal,
  id: string,
  side: "current" | "proposed",
  raw: PreviewAnswer,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.saveProcedurePreviewAnswer(owner, id, side, raw);

  z.uuid().parse(id);
  const answer = PreviewAnswer.parse(raw);
  return transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    const [row] = await tx
      .select()
      .from(procedurePreview)
      .where(
        and(
          eq(procedurePreview.id, id),
          eq(procedurePreview.sellerId, owner.sellerId),
        ),
      )
      .for("update");
    if (!row) throw notFound("preview");
    if (row.state !== "running" || row.expiresAt <= new Date())
      throw conflict(
        "This comparison expired or finished. Earlier replies remain saved.",
      );
    if (
      (side === "current" && row.currentAnswer) ||
      (side === "proposed" && (!row.currentAnswer || row.proposedAnswer))
    )
      throw conflict("This reply was already saved or arrived out of order.");
    const [saved] = await tx
      .update(procedurePreview)
      .set(
        side === "current"
          ? { currentAnswer: answer }
          : { proposedAnswer: answer, state: "completed" },
      )
      .where(eq(procedurePreview.id, id))
      .returning();
    await recordAudit(tx, {
      actor: "assistant",
      actorId: owner.userId,
      operation: "procedure_preview.answer",
      targetType: "procedure_preview",
      targetId: id,
      outcome: "ok",
      details: { side },
    });
    return saved!;
  });
}

/** Marks an unfinished run failed using a safe message, never a stand-in answer. */
export async function failProcedurePreview(owner: OwnerPrincipal, id: string) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.failProcedurePreview(owner, id);

  z.uuid().parse(id);
  await transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    await tx
      .update(procedurePreview)
      .set({
        state: "failed",
        failure:
          "The model could not finish. Any completed reply is saved. Check the connection or try again later.",
      })
      .where(
        and(
          eq(procedurePreview.id, id),
          eq(procedurePreview.sellerId, owner.sellerId),
          eq(procedurePreview.state, "running"),
        ),
      );
  });
}

/** Returns only useful owner fields and labels interrupted work without changing saved records. */
export function procedurePreviewView(
  row: ProcedurePreviewRow,
): ProcedurePreviewView {
  const expired = row.state === "running" && row.expiresAt <= new Date();
  return {
    id: row.id,
    procedureId: row.procedureId,
    revision: row.revision,
    publishedRevision: row.publishedRevision,
    question: row.question,
    wording: row.wording,
    generator: row.generator,
    state: expired ? "failed" : row.state,
    current: row.currentAnswer,
    proposed: row.proposedAnswer,
    failure: expired
      ? "This comparison did not finish. Any completed reply is kept."
      : row.failure,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads saved comparisons only within the current authenticated owner's shop. */
export async function listProcedurePreviews(
  owner: OwnerPrincipal,
): Promise<ProcedurePreviewView[]> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.listProcedurePreviews(owner);

  const db = getDb();
  await ownerScope(owner, db);
  return (
    await db
      .select()
      .from(procedurePreview)
      .where(eq(procedurePreview.sellerId, owner.sellerId))
      .orderBy(desc(procedurePreview.createdAt), desc(procedurePreview.id))
      .limit(20)
  ).map(procedurePreviewView);
}
