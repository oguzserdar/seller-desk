import {
  LearningPreviewInput,
  PreviewAnswer,
  type PreviewFacts,
} from "@/lib/learning-preview";
import {
  PublishLearningInput,
  changedFindingConflicts,
  sourceWithPublications,
} from "@/lib/learning-publication";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  learningPreview,
  learningPublication,
  learningReview,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import {
  learningPreviewView,
  type LearningPreviewRow,
} from "@/server/domain/learning-preview";
import { learningSourceHash } from "@/server/domain/learning-review";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { assertD1LearningOwner } from "./learning-review";
import { captureD1LearningSource } from "./learning-source";

const Wording = PublishLearningInput.omit({
  reviewId: true,
  expectedRevision: true,
  confirmReusable: true,
});

/** Native private fact comparisons retain failed and partial provider results without publishing them. */
export function createD1LearningPreviews(db: D1Db) {
  return {
    async claimLearningPreview(
      owner: OwnerPrincipal,
      raw: LearningPreviewInput,
      generator: string,
    ) {
      const input = LearningPreviewInput.parse(raw);
      z.string().min(1).max(200).parse(generator);
      const shop = await assertD1LearningOwner(db, owner);
      const reuse = (row: LearningPreviewRow) => {
        if (row.sellerId !== owner.sellerId) throw notFound("preview");
        if (
          row.reviewId !== input.reviewId ||
          row.reviewRevision !== input.expectedRevision ||
          row.findingIndex !== input.findingIndex ||
          row.question !== input.question
        )
          throw conflict(
            "This preview request was already used for a different question or draft.",
          );
        return { created: false, row, dailyLimit: shop.sellerDailyAiTurns };
      };
      const [prior] = await db
        .select()
        .from(learningPreview)
        .where(eq(learningPreview.id, input.requestId));
      if (prior) return reuse(prior);
      const [review] = await db
        .select()
        .from(learningReview)
        .where(
          and(
            eq(learningReview.id, input.reviewId),
            eq(learningReview.sellerId, owner.sellerId),
          ),
        );
      if (!review) throw notFound("review");
      if (
        review.state !== "draft" ||
        review.revision !== input.expectedRevision
      )
        throw conflict(
          "This review changed. Reload its saved draft before trying an answer.",
        );
      const publications = await db
        .select()
        .from(learningPublication)
        .where(
          and(
            eq(learningPublication.reviewId, review.id),
            eq(learningPublication.sellerId, owner.sellerId),
          ),
        )
        .orderBy(
          asc(learningPublication.createdAt),
          asc(learningPublication.guideRevision),
        );
      if (publications.some((row) => row.findingIndex === input.findingIndex))
        throw conflict(
          "This fact is already published. Its earlier previews remain in your records.",
        );
      const current = await captureD1LearningSource(
        db,
        owner,
        review.questionId,
      );
      if (
        learningSourceHash(current.source) !==
          learningSourceHash(
            sourceWithPublications(review.source, publications),
          ) ||
        changedFindingConflicts(
          review.analysis,
          review.source,
          current.source,
          publications,
        )
      )
        throw conflict(
          "The source changed. Review the current answer before trying its draft.",
        );
      const finding = review.analysis.findings[input.findingIndex];
      if (
        !finding ||
        !["reusable_fact", "product_rule", "temporary_information"].includes(
          finding.kind,
        )
      )
        throw invalid(
          "Private exceptions and unresolved problems cannot be tested as public facts.",
        );
      const parsed = Wording.safeParse(
        review.editedDrafts.find(
          (draft) => draft.findingIndex === input.findingIndex,
        ),
      );
      if (!parsed.success)
        throw invalid(
          "Save complete public wording, scope and conflict decisions before trying an answer.",
        );
      const draft = parsed.data;
      if (
        finding.conflictingPolicyFields.length ||
        finding.conflictingProductIds.length
      )
        throw invalid(
          "Resolve the checkout or product conflict before trying this draft.",
        );
      if (
        (finding.kind === "product_rule" && !draft.productId) ||
        (draft.productId &&
          !current.source.products.some(
            (product) => product.id === draft.productId,
          ))
      )
        throw invalid("Choose a published product in this shop.");
      if (
        (finding.kind === "temporary_information" && !draft.validUntil) ||
        (draft.validUntil && new Date(draft.validUntil) <= new Date())
      )
        throw invalid("Choose a future expiry for this fact.");
      if (finding.questions.length && draft.clarification.length < 5)
        throw invalid("Save your answers to the open questions first.");
      if (
        draft.conflicts.length !== finding.conflictingGuideIds.length ||
        new Set(draft.conflicts.map((row) => row.guideId)).size !==
          draft.conflicts.length ||
        draft.conflicts.some(
          (row) => !finding.conflictingGuideIds.includes(row.guideId),
        )
      )
        throw invalid("Resolve every identified knowledge conflict first.");
      const replacements = draft.conflicts
        .filter((row) => row.resolution === "replace")
        .map((row) => row.guideId);
      if (replacements.length > 1)
        throw invalid("Replace one existing rule at a time.");
      const currentFacts: PreviewFacts = {
          terms: current.source.terms,
          products: current.source.products,
          guides: current.source.guides,
        },
        proposedFacts: PreviewFacts = {
          ...currentFacts,
          guides: [
            ...current.source.guides.filter(
              (guide) => !replacements.includes(guide.id),
            ),
            {
              id: input.requestId,
              revision: 1,
              title: draft.title,
              body: draft.body,
              topic: draft.topic,
              productId: draft.productId,
              validUntil: draft.validUntil,
            },
          ],
        };
      const execution = crypto.randomUUID();
      try {
        const [, , rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:preview`,
            sql`${current.guard} and exists(select 1 from learning_review where id=${review.id} and seller_id=${owner.sellerId} and revision=${input.expectedRevision} and state='draft') and not exists(select 1 from learning_publication where review_id=${review.id} and finding_index=${input.findingIndex}) and not exists(select 1 from learning_preview where id=${input.requestId}) and not exists(select 1 from learning_preview where seller_id=${owner.sellerId} and state='running' and expires_at>${nowMilliseconds}) and ${draft.validUntil ? sql`${new Date(draft.validUntil).getTime()}>${nowMilliseconds}` : sql`1`}`,
          ),
          db
            .update(learningPreview)
            .set({
              state: "failed",
              failure:
                "The preview did not finish. Start a new comparison when ready.",
            })
            .where(
              and(
                eq(learningPreview.sellerId, owner.sellerId),
                eq(learningPreview.state, "running"),
                sql`${learningPreview.expiresAt}<=${nowMilliseconds}`,
              ),
            ),
          db
            .insert(learningPreview)
            .values({
              id: input.requestId,
              sellerId: owner.sellerId,
              reviewId: review.id,
              reviewRevision: review.revision,
              findingIndex: input.findingIndex,
              question: input.question,
              sourceHash: learningSourceHash(current.source),
              draftBody: draft.body,
              currentFacts,
              proposedFacts,
              generator,
              expiresAt: new Date(Date.now() + 120000),
            })
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "learning_preview.start",
              targetType: "learning_preview",
              targetId: input.requestId,
              outcome: "ok",
              details: {
                reviewId: review.id,
                findingIndex: input.findingIndex,
              },
            }),
          clearBatchGuards(db, execution),
        ]);
        return {
          created: true,
          row: rows[0]!,
          dailyLimit: shop.sellerDailyAiTurns,
        };
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const [winner] = await db
            .select()
            .from(learningPreview)
            .where(eq(learningPreview.id, input.requestId));
          if (winner) return reuse(winner);
          throw conflict(
            "The saved draft changed or a comparison is already running. Refresh before trying again.",
          );
        }
        throw error;
      }
    },
    async savePreviewAnswer(
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
        .from(learningPreview)
        .where(
          and(
            eq(learningPreview.id, id),
            eq(learningPreview.sellerId, owner.sellerId),
          ),
        );
      if (!row) throw notFound("preview");
      if (row.state !== "running" || row.expiresAt <= new Date())
        throw conflict(
          "This preview expired or finished. Its earlier results are saved.",
        );
      if (
        (side === "current" && row.currentAnswer) ||
        (side === "proposed" && (!row.currentAnswer || row.proposedAnswer))
      )
        throw conflict(
          "This preview result was already saved or is out of order.",
        );
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:answer`,
            sql`${ownerScope(owner)} and exists(select 1 from learning_preview where id=${id} and seller_id=${owner.sellerId} and state='running' and expires_at>${nowMilliseconds} and ${side === "current" ? sql`current_answer is null` : sql`current_answer is not null and proposed_answer is null`})`,
          ),
          db
            .update(learningPreview)
            .set(
              side === "current"
                ? { currentAnswer: answer }
                : { proposedAnswer: answer, state: "completed" },
            )
            .where(eq(learningPreview.id, id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "assistant",
              actorId: owner.userId,
              operation: "learning_preview.answer",
              targetType: "learning_preview",
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
            "This preview result was already saved, expired or arrived out of order.",
          );
        throw error;
      }
    },
    async failLearningPreview(
      owner: OwnerPrincipal,
      id: string,
    ): Promise<void> {
      z.uuid().parse(id);
      await assertD1LearningOwner(db, owner);
      await db
        .update(learningPreview)
        .set({
          state: "failed",
          failure:
            "The model could not finish this comparison. Any completed answer is saved. Check the connection or try again later.",
        })
        .where(
          and(
            eq(learningPreview.id, id),
            eq(learningPreview.sellerId, owner.sellerId),
            eq(learningPreview.state, "running"),
            ownerScope(owner),
          ),
        );
    },
    async listLearningPreviews(owner: OwnerPrincipal) {
      await assertD1LearningOwner(db, owner);
      return (
        await db
          .select()
          .from(learningPreview)
          .where(eq(learningPreview.sellerId, owner.sellerId))
          .orderBy(desc(learningPreview.createdAt), desc(learningPreview.id))
          .limit(20)
      ).map(learningPreviewView);
    },
  };
}
