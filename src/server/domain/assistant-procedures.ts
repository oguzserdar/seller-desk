import { getStorage } from "@/server/storage";
/** Versioned owner directions over the assistant's existing capabilities. */
import {
  PROCEDURE_LIMIT,
  ProcedureContent,
  PublishProcedureInput,
  SaveProcedureInput,
} from "@/lib/assistant-procedure";
import {
  getDb,
  transaction,
  type Queryable,
  type Tx,
} from "@/server/db/client";
import {
  assistantProcedure,
  assistantProcedureVersion,
  buyerSession,
  seller,
} from "@/server/db/schema";
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

/** Owner-only draft state and the exact live version pointer. */
export type ProcedureRow = typeof assistantProcedure.$inferSelect;

async function ownerScope(owner: OwnerPrincipal, db: Queryable, lock = false) {
  const query = db
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("shop");
}
async function capacity(owner: OwnerPrincipal, tx: Tx) {
  const [total] = await tx
    .select({ n: count() })
    .from(assistantProcedure)
    .where(
      and(
        eq(assistantProcedure.sellerId, owner.sellerId),
        eq(assistantProcedure.archived, false),
      ),
    );
  if ((total?.n ?? 0) >= PROCEDURE_LIMIT)
    throw invalid(
      `Keep at most ${PROCEDURE_LIMIT} handling instructions. Archive one before adding another.`,
    );
}
async function current(owner: OwnerPrincipal, id: string, tx: Tx) {
  z.uuid().parse(id);
  const [row] = await tx
    .select()
    .from(assistantProcedure)
    .where(
      and(
        eq(assistantProcedure.id, id),
        eq(assistantProcedure.sellerId, owner.sellerId),
      ),
    )
    .for("update");
  if (!row) throw notFound("handling instruction");
  return row;
}
function expected(row: ProcedureRow, revision: number) {
  z.number().int().positive().parse(revision);
  if (row.revision !== revision)
    throw conflict("This instruction changed. Reload it before continuing.");
}
function same(a: ProcedureContent, b: ProcedureContent) {
  return (
    a.title === b.title && a.whenToUse === b.whenToUse && a.steps === b.steps
  );
}
async function version(tx: Tx, row: ProcedureRow) {
  await tx
    .insert(assistantProcedureVersion)
    .values({
      procedureId: row.id,
      sellerId: row.sellerId,
      revision: row.revision,
      content: row.content,
    });
}
async function audit(
  owner: OwnerPrincipal,
  tx: Tx,
  operation: string,
  row: ProcedureRow,
) {
  await recordAudit(tx, {
    actor: "owner",
    actorId: owner.userId,
    operation: `assistant_procedure.${operation}`,
    targetType: "assistant_procedure",
    targetId: row.id,
    outcome: "ok",
    details: {
      revision: row.revision,
      publishedRevision: row.publishedRevision,
    },
  });
}

/** Reads only this owner's drafts, live pointers and optionally archived instructions. */
export async function listProcedures(
  owner: OwnerPrincipal,
  includeArchived = false,
): Promise<ProcedureRow[]> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.listProcedures(owner, includeArchived);

  const db = getDb();
  await ownerScope(owner, db);
  return db
    .select()
    .from(assistantProcedure)
    .where(
      and(
        eq(assistantProcedure.sellerId, owner.sellerId),
        includeArchived ? undefined : eq(assistantProcedure.archived, false),
      ),
    )
    .orderBy(asc(assistantProcedure.createdAt));
}

/** Saves a draft without replacing the live version; exact dropped-response retries reuse it. */
export async function saveProcedure(
  owner: OwnerPrincipal,
  raw: SaveProcedureInput,
): Promise<ProcedureRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.saveProcedure(owner, raw);

  const input = SaveProcedureInput.parse(raw);
  return transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    const [existing] = await tx
      .select()
      .from(assistantProcedure)
      .where(eq(assistantProcedure.id, input.id))
      .for("update");
    if (existing && existing.sellerId !== owner.sellerId)
      throw notFound("handling instruction");
    if (existing?.archived)
      throw conflict("Restore an archived version before editing it.");
    if (
      existing &&
      existing.revision === input.expectedRevision + 1 &&
      same(existing.content, input.content)
    )
      return existing;
    let row: ProcedureRow | undefined;
    if (existing) {
      expected(existing, input.expectedRevision);
      if (same(existing.content, input.content)) return existing;
      [row] = await tx
        .update(assistantProcedure)
        .set({ content: input.content, revision: existing.revision + 1 })
        .where(eq(assistantProcedure.id, existing.id))
        .returning();
    } else {
      if (input.expectedRevision !== 0) throw notFound("handling instruction");
      await capacity(owner, tx);
      [row] = await tx
        .insert(assistantProcedure)
        .values({
          id: input.id,
          sellerId: owner.sellerId,
          content: input.content,
        })
        .returning();
    }
    if (!row) throw new Error("procedure save returned nothing");
    await version(tx, row);
    await audit(owner, tx, "save", row);
    return row;
  });
}

/** Publishes only the exact saved version named by a separate explicit owner approval. */
export async function publishProcedure(
  owner: OwnerPrincipal,
  raw: PublishProcedureInput,
): Promise<ProcedureRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.publishProcedure(owner, raw);

  const input = PublishProcedureInput.parse(raw);
  return transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    const row = await current(owner, input.id, tx);
    expected(row, input.expectedRevision);
    if (row.archived)
      throw conflict("Restore this instruction before publishing it.");
    if (row.publishedRevision === row.revision) return row;
    const [saved] = await tx
      .select()
      .from(assistantProcedureVersion)
      .where(
        and(
          eq(assistantProcedureVersion.procedureId, row.id),
          eq(assistantProcedureVersion.sellerId, owner.sellerId),
          eq(assistantProcedureVersion.revision, row.revision),
        ),
      );
    if (!saved || !same(saved.content, row.content))
      throw conflict(
        "The saved wording is unavailable. Save a new draft before publishing.",
      );
    const [published] = await tx
      .update(assistantProcedure)
      .set({ publishedRevision: row.revision })
      .where(eq(assistantProcedure.id, row.id))
      .returning();
    await audit(owner, tx, "publish", published!);
    return published!;
  });
}

/** Stops live use and advances the revision so old publication requests cannot revive it. */
export async function pauseProcedure(
  owner: OwnerPrincipal,
  id: string,
  expectedRevision: number,
  archive = false,
): Promise<ProcedureRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.pauseProcedure(
      owner,
      id,
      expectedRevision,
      archive,
    );

  return transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    const row = await current(owner, id, tx);
    expected(row, expectedRevision);
    if (row.archived) throw conflict("This instruction is already archived.");
    const [paused] = await tx
      .update(assistantProcedure)
      .set({
        publishedRevision: null,
        archived: archive,
        revision: row.revision + 1,
      })
      .where(eq(assistantProcedure.id, id))
      .returning();
    await version(tx, paused!);
    await audit(owner, tx, archive ? "archive" : "pause", paused!);
    return paused!;
  });
}

/** Preserves immutable wording and current publication separately for the owner's history view. */
export async function procedureHistory(owner: OwnerPrincipal, id: string) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.procedureHistory(owner, id);

  z.uuid().parse(id);
  const db = getDb();
  await ownerScope(owner, db);
  const [row] = await db
    .select()
    .from(assistantProcedure)
    .where(
      and(
        eq(assistantProcedure.id, id),
        eq(assistantProcedure.sellerId, owner.sellerId),
      ),
    );
  if (!row) throw notFound("handling instruction");
  const versions = await db
    .select()
    .from(assistantProcedureVersion)
    .where(
      and(
        eq(assistantProcedureVersion.procedureId, id),
        eq(assistantProcedureVersion.sellerId, owner.sellerId),
      ),
    )
    .orderBy(desc(assistantProcedureVersion.revision))
    .limit(100);
  // The owner must still be able to inspect the live wording after many private drafts.
  if (
    row.publishedRevision !== null &&
    !versions.some((saved) => saved.revision === row.publishedRevision)
  ) {
    const [live] = await db
      .select()
      .from(assistantProcedureVersion)
      .where(
        and(
          eq(assistantProcedureVersion.procedureId, id),
          eq(assistantProcedureVersion.sellerId, owner.sellerId),
          eq(assistantProcedureVersion.revision, row.publishedRevision),
        ),
      );
    if (live) versions.push(live);
  }
  return versions;
}

/** Restores wording into a new private draft; live customers keep the existing approved version. */
export async function restoreProcedure(
  owner: OwnerPrincipal,
  id: string,
  expectedRevision: number,
  restoreRevision: number,
): Promise<ProcedureRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.restoreProcedure(
      owner,
      id,
      expectedRevision,
      restoreRevision,
    );

  z.number().int().positive().parse(restoreRevision);
  return transaction(getDb(), async (tx) => {
    await ownerScope(owner, tx, true);
    const row = await current(owner, id, tx);
    expected(row, expectedRevision);
    const [saved] = await tx
      .select()
      .from(assistantProcedureVersion)
      .where(
        and(
          eq(assistantProcedureVersion.procedureId, id),
          eq(assistantProcedureVersion.sellerId, owner.sellerId),
          eq(assistantProcedureVersion.revision, restoreRevision),
        ),
      );
    if (!saved) throw notFound("saved instruction version");
    if (row.archived) await capacity(owner, tx);
    const [restored] = await tx
      .update(assistantProcedure)
      .set({
        content: ProcedureContent.parse(saved.content),
        revision: row.revision + 1,
        archived: false,
      })
      .where(eq(assistantProcedure.id, id))
      .returning();
    await version(tx, restored!);
    await audit(owner, tx, "restore", restored!);
    return restored!;
  });
}

/** Server-only instructions for an authenticated, unexpired buyer; never a buyer-visible facts tool. */
export async function publishedProceduresForBuyer(
  buyer: BuyerPrincipal,
): Promise<ProcedureContent[]> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.procedures.publishedProceduresForBuyer(buyer);

  const db = getDb();
  const [session] = await db
    .select({ id: buyerSession.id })
    .from(buyerSession)
    .where(
      and(
        eq(buyerSession.id, buyer.buyerSessionId),
        eq(buyerSession.sellerId, buyer.sellerId),
        isNull(buyerSession.revokedAt),
        sql`${buyerSession.expiresAt} > now()`,
      ),
    );
  if (!session) throw notFound("current customer conversation");
  const rows = await db
    .select({ content: assistantProcedureVersion.content })
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
        eq(assistantProcedure.sellerId, buyer.sellerId),
        eq(assistantProcedure.archived, false),
        isNotNull(assistantProcedure.publishedRevision),
      ),
    )
    .orderBy(asc(assistantProcedure.createdAt))
    .limit(PROCEDURE_LIMIT);
  return rows.map((row) => ProcedureContent.parse(row.content));
}
