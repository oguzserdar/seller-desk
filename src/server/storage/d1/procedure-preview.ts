import { PreviewAnswer } from "@/lib/learning-preview";
import { ProcedurePreviewInput } from "@/lib/procedure-preview";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  assistantProcedure,
  assistantProcedureVersion,
  auditEvent,
  procedurePreview,
} from "@/server/db/sqlite/schema";
import { conflict, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import {
  procedurePreviewView,
  type ProcedurePreviewRow,
} from "@/server/domain/procedure-preview";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { assertD1LearningOwner } from "./learning-review";
import {
  d1LearningFacts,
  d1LearningFactsGuard,
  d1LearningFactsQueries,
} from "./learning-source";

/** Native private instruction comparisons never mutate public instructions or commerce. */
export function createD1ProcedurePreviews(db: D1Db) {
  return {
    async claimProcedurePreview(
      owner: OwnerPrincipal,
      raw: ProcedurePreviewInput,
      generator: string,
    ) {
      const input = ProcedurePreviewInput.parse(raw);
      z.string().min(1).max(200).parse(generator);
      const shop = await assertD1LearningOwner(db, owner);
      const [prior] = await db
        .select()
        .from(procedurePreview)
        .where(eq(procedurePreview.id, input.requestId));
      const reuse = (row: ProcedurePreviewRow) => {
        if (row.sellerId !== owner.sellerId) throw notFound("preview");
        if (
          row.procedureId !== input.procedureId ||
          row.revision !== input.expectedRevision ||
          row.question !== input.question
        )
          throw conflict(
            "This preview request already names another question or version.",
          );
        return { created: false, row, dailyLimit: shop.sellerDailyAiTurns };
      };
      if (prior) return reuse(prior);
      const [shops, products, guides, drafts, published] = await db.batch([
        ...d1LearningFactsQueries(db, owner),
        db
          .select()
          .from(assistantProcedure)
          .where(
            and(
              eq(assistantProcedure.id, input.procedureId),
              eq(assistantProcedure.sellerId, owner.sellerId),
            ),
          ),
        db
          .select({
            id: assistantProcedure.id,
            revision: assistantProcedure.publishedRevision,
            content: assistantProcedureVersion.content,
          })
          .from(assistantProcedure)
          .innerJoin(
            assistantProcedureVersion,
            and(
              eq(assistantProcedureVersion.procedureId, assistantProcedure.id),
              eq(
                assistantProcedureVersion.sellerId,
                assistantProcedure.sellerId,
              ),
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
          .orderBy(
            asc(assistantProcedure.createdAt),
            asc(assistantProcedure.id),
          ),
      ]);
      if (!shops[0]) throw notFound("shop");
      const draft = drafts[0];
      if (!draft) throw notFound("instruction");
      if (draft.archived || draft.revision !== input.expectedRevision)
        throw conflict(
          "This instruction changed. Reload the saved wording before comparing replies.",
        );
      const facts = d1LearningFacts(shops[0], products, guides),
        proposed = published.some((row) => row.id === draft.id)
          ? published.map((row) =>
              row.id === draft.id ? draft.content : row.content,
            )
          : [...published.map((row) => row.content), draft.content];
      const execution = crypto.randomUUID();
      try {
        const [, , rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:preview`,
            sql`${d1LearningFactsGuard(owner, facts)} and exists(select 1 from assistant_procedure where id=${draft.id} and seller_id=${owner.sellerId} and revision=${draft.revision} and published_revision is ${draft.publishedRevision} and archived=0)
        and (select count(*) from assistant_procedure where seller_id=${owner.sellerId} and archived=0 and published_revision is not null)=${published.length}
        and not exists(select 1 from json_each(${JSON.stringify(published)}) e left join assistant_procedure p on p.id=json_extract(e.value,'$.id') and p.seller_id=${owner.sellerId} and p.archived=0 left join assistant_procedure_version v on v.procedure_id=p.id and v.revision=p.published_revision and v.seller_id=p.seller_id where p.published_revision is not json_extract(e.value,'$.revision') or v.content is not json_extract(e.value,'$.content'))
        and not exists(select 1 from procedure_preview where seller_id=${owner.sellerId} and state='running' and expires_at>${nowMilliseconds}) and not exists(select 1 from procedure_preview where id=${input.requestId})`,
          ),
          db
            .update(procedurePreview)
            .set({
              state: "failed",
              failure:
                "This comparison did not finish. Any completed reply is kept.",
            })
            .where(
              and(
                eq(procedurePreview.sellerId, owner.sellerId),
                eq(procedurePreview.state, "running"),
                sql`${procedurePreview.expiresAt}<=${nowMilliseconds}`,
              ),
            ),
          db
            .insert(procedurePreview)
            .values({
              id: input.requestId,
              sellerId: owner.sellerId,
              procedureId: draft.id,
              revision: draft.revision,
              publishedRevision: draft.publishedRevision,
              question: input.question,
              wording: draft.content,
              facts,
              currentInstructions: published.map((row) => row.content),
              proposedInstructions: proposed,
              generator,
              expiresAt: new Date(Date.now() + 120000),
            })
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "procedure_preview.start",
              targetType: "procedure_preview",
              targetId: input.requestId,
              outcome: "ok",
              details: { procedureId: draft.id, revision: draft.revision },
            }),
          clearBatchGuards(db, execution),
        ]);
        return {
          created: true,
          row: rows[0]!,
          dailyLimit: shops[0].sellerDailyAiTurns,
        };
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const [winner] = await db
            .select()
            .from(procedurePreview)
            .where(eq(procedurePreview.id, input.requestId));
          if (winner) return reuse(winner);
          throw conflict(
            "The saved wording changed or a reply comparison is already running. Refresh before trying again.",
          );
        }
        throw error;
      }
    },
    async saveProcedurePreviewAnswer(
      owner: OwnerPrincipal,
      id: string,
      side: "current" | "proposed",
      raw: PreviewAnswer,
    ) {
      z.uuid().parse(id);
      const answer = PreviewAnswer.parse(raw);
      await assertD1LearningOwner(db, owner);
      const [row] = await db
        .select()
        .from(procedurePreview)
        .where(
          and(
            eq(procedurePreview.id, id),
            eq(procedurePreview.sellerId, owner.sellerId),
          ),
        );
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
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:answer`,
            sql`${ownerScope(owner)} and exists(select 1 from procedure_preview where id=${id} and seller_id=${owner.sellerId} and state='running' and expires_at>${nowMilliseconds} and ${side === "current" ? sql`current_answer is null` : sql`current_answer is not null and proposed_answer is null`})`,
          ),
          db
            .update(procedurePreview)
            .set(
              side === "current"
                ? { currentAnswer: answer }
                : { proposedAnswer: answer, state: "completed" },
            )
            .where(eq(procedurePreview.id, id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "assistant",
              actorId: owner.userId,
              operation: "procedure_preview.answer",
              targetType: "procedure_preview",
              targetId: id,
              outcome: "ok",
              details: { side },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This reply was already saved, expired or arrived out of order.",
          );
        throw error;
      }
    },
    async failProcedurePreview(
      owner: OwnerPrincipal,
      id: string,
    ): Promise<void> {
      z.uuid().parse(id);
      await assertD1LearningOwner(db, owner);
      await db
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
            ownerScope(owner),
          ),
        );
    },
    async listProcedurePreviews(owner: OwnerPrincipal) {
      await assertD1LearningOwner(db, owner);
      return (
        await db
          .select()
          .from(procedurePreview)
          .where(eq(procedurePreview.sellerId, owner.sellerId))
          .orderBy(desc(procedurePreview.createdAt), desc(procedurePreview.id))
          .limit(20)
      ).map(procedurePreviewView);
    },
  };
}
