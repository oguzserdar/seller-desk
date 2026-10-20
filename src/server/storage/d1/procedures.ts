import {
  PROCEDURE_LIMIT,
  ProcedureContent,
  PublishProcedureInput,
  SaveProcedureInput,
} from "@/lib/assistant-procedure";
import {
  assistantProcedure,
  assistantProcedureVersion,
  auditEvent,
  seller,
} from "@/server/db/sqlite/schema";
import type { ProcedureRow } from "@/server/domain/assistant-procedures";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

const same = (a: ProcedureContent, b: ProcedureContent) =>
  a.title === b.title && a.whenToUse === b.whenToUse && a.steps === b.steps;
async function owned(db: D1Db, owner: OwnerPrincipal): Promise<void> {
  if (
    !(
      await db.select({ id: seller.id }).from(seller).where(ownerScope(owner))
    )[0]
  )
    throw notFound("shop");
}
async function capacity(db: D1Db, owner: OwnerPrincipal): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(assistantProcedure)
    .where(
      and(
        eq(assistantProcedure.sellerId, owner.sellerId),
        eq(assistantProcedure.archived, false),
      ),
    );
  if ((row?.n ?? 0) >= PROCEDURE_LIMIT)
    throw invalid(
      `Keep at most ${PROCEDURE_LIMIT} handling instructions. Archive one before adding another.`,
    );
}
async function current(
  db: D1Db,
  owner: OwnerPrincipal,
  id: string,
  revision: number,
): Promise<ProcedureRow> {
  z.uuid().parse(id);
  z.number().int().positive().parse(revision);
  await owned(db, owner);
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
  if (row.revision !== revision)
    throw conflict("This instruction changed. Reload it before continuing.");
  return row;
}
async function commit(
  db: D1Db,
  owner: OwnerPrincipal,
  previous: ProcedureRow | null,
  next: typeof assistantProcedure.$inferInsert,
  operation: string,
  extra: SQL = sql`1`,
): Promise<ProcedureRow> {
  const execution = crypto.randomUUID(),
    id = next.id;
  const version = operation !== "publish";
  try {
    const results = await db.batch([
      batchGuard(
        db,
        `${execution}:instruction`,
        sql`${ownerScope(owner)} and ${extra} and ${previous ? sql`exists(select 1 from assistant_procedure where id=${id} and seller_id=${owner.sellerId} and revision=${previous.revision} and archived=${Number(previous.archived)} and published_revision is ${previous.publishedRevision})` : sql`not exists(select 1 from assistant_procedure where id=${id})`}`,
      ),
      previous
        ? db
            .update(assistantProcedure)
            .set({ ...next, updatedAt: new Date() })
            .where(eq(assistantProcedure.id, id))
        : db.insert(assistantProcedure).values(next),
      ...(version
        ? [
            db
              .insert(assistantProcedureVersion)
              .values({
                procedureId: id,
                sellerId: owner.sellerId,
                revision: next.revision!,
                content: next.content,
              }),
          ]
        : []),
      db
        .insert(auditEvent)
        .values({
          actor: "owner",
          actorId: owner.userId,
          operation: `assistant_procedure.${operation}`,
          targetType: "assistant_procedure",
          targetId: id,
          outcome: "ok",
          details: {
            revision: next.revision!,
            publishedRevision: next.publishedRevision ?? null,
          },
        }),
      db.select().from(assistantProcedure).where(eq(assistantProcedure.id, id)),
      clearBatchGuards(db, execution),
    ]);
    return (results[results.length - 2] as ProcedureRow[])[0]!;
  } catch (error) {
    if (isBatchGuardFailure(error))
      throw conflict(
        "This instruction or the active instruction limit changed. Reload it before continuing.",
      );
    throw error;
  }
}
const room = (owner: OwnerPrincipal) =>
  sql`(select count(*) from assistant_procedure where seller_id=${owner.sellerId} and archived=0)<${PROCEDURE_LIMIT}`;

/** Native versioned handling instructions keep private drafts separate from live wording. */
export function createD1ProcedureStorage(db: D1Db) {
  return {
    async listProcedures(
      owner: OwnerPrincipal,
      includeArchived = false,
    ): Promise<ProcedureRow[]> {
      await owned(db, owner);
      return db
        .select()
        .from(assistantProcedure)
        .where(
          and(
            eq(assistantProcedure.sellerId, owner.sellerId),
            includeArchived
              ? undefined
              : eq(assistantProcedure.archived, false),
          ),
        )
        .orderBy(asc(assistantProcedure.createdAt));
    },
    async saveProcedure(
      owner: OwnerPrincipal,
      raw: SaveProcedureInput,
    ): Promise<ProcedureRow> {
      const input = SaveProcedureInput.parse(raw);
      await owned(db, owner);
      const [row] = await db
        .select()
        .from(assistantProcedure)
        .where(eq(assistantProcedure.id, input.id));
      if (row && row.sellerId !== owner.sellerId)
        throw notFound("handling instruction");
      if (row?.archived)
        throw conflict("Restore an archived version before editing it.");
      if (
        row &&
        row.revision === input.expectedRevision + 1 &&
        same(row.content, input.content)
      )
        return row;
      if (row) {
        if (row.revision !== input.expectedRevision)
          throw conflict(
            "This instruction changed. Reload it before continuing.",
          );
        if (same(row.content, input.content)) return row;
      } else {
        if (input.expectedRevision !== 0)
          throw notFound("handling instruction");
        await capacity(db, owner);
      }
      return commit(
        db,
        owner,
        row ?? null,
        {
          ...row,
          id: input.id,
          sellerId: owner.sellerId,
          revision: (row?.revision ?? 0) + 1,
          content: input.content,
          publishedRevision: row?.publishedRevision ?? null,
          archived: false,
        },
        "save",
        row ? sql`1` : room(owner),
      );
    },
    async publishProcedure(
      owner: OwnerPrincipal,
      raw: PublishProcedureInput,
    ): Promise<ProcedureRow> {
      const input = PublishProcedureInput.parse(raw),
        row = await current(db, owner, input.id, input.expectedRevision);
      if (row.archived)
        throw conflict("Restore this instruction before publishing it.");
      if (row.publishedRevision === row.revision) return row;
      const [saved] = await db
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
      return commit(
        db,
        owner,
        row,
        { ...row, publishedRevision: row.revision },
        "publish",
        sql`exists(select 1 from assistant_procedure_version where procedure_id=${row.id} and seller_id=${owner.sellerId} and revision=${row.revision} and content=${JSON.stringify(saved.content)})`,
      );
    },
    async pauseProcedure(
      owner: OwnerPrincipal,
      id: string,
      expectedRevision: number,
      archive = false,
    ): Promise<ProcedureRow> {
      const row = await current(db, owner, id, expectedRevision);
      if (row.archived) throw conflict("This instruction is already archived.");
      return commit(
        db,
        owner,
        row,
        {
          ...row,
          publishedRevision: null,
          archived: archive,
          revision: row.revision + 1,
        },
        archive ? "archive" : "pause",
      );
    },
    async procedureHistory(owner: OwnerPrincipal, id: string) {
      z.uuid().parse(id);
      await owned(db, owner);
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
    },
    async restoreProcedure(
      owner: OwnerPrincipal,
      id: string,
      expectedRevision: number,
      restoreRevision: number,
    ): Promise<ProcedureRow> {
      z.number().int().positive().parse(restoreRevision);
      const row = await current(db, owner, id, expectedRevision);
      const [saved] = await db
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
      if (row.archived) await capacity(db, owner);
      return commit(
        db,
        owner,
        row,
        {
          ...row,
          content: ProcedureContent.parse(saved.content),
          revision: row.revision + 1,
          archived: false,
        },
        "restore",
        row.archived ? room(owner) : sql`1`,
      );
    },
    async publishedProceduresForBuyer(
      buyer: BuyerPrincipal,
    ): Promise<ProcedureContent[]> {
      const [session] = await db
        .select({ id: seller.id })
        .from(seller)
        .where(and(eq(seller.id, buyer.sellerId), buyerScope(buyer)));
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
    },
  };
}
