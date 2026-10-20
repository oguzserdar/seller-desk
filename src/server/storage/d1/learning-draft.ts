import {
  SaveLearningDraftInput,
  sameLearningDraft,
} from "@/lib/learning-draft";
import {
  auditEvent,
  learningPublication,
  learningReview,
  offer,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { assertD1LearningOwner } from "./learning-review";

/** Native private wording saves do not grant publication consent. */
export function createD1LearningDrafts(db: D1Db) {
  return {
    async saveLearningDraft(
      owner: OwnerPrincipal,
      raw: SaveLearningDraftInput,
    ): Promise<{ revision: number }> {
      const input = SaveLearningDraftInput.parse(raw);
      await assertD1LearningOwner(db, owner);
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
      if (review.state !== "draft")
        throw conflict("Reopen this review before saving edits.");
      const finding = review.analysis.findings[input.draft.findingIndex];
      if (
        !finding ||
        !["reusable_fact", "product_rule", "temporary_information"].includes(
          finding.kind,
        )
      )
        throw invalid("Only a reusable fact can have public wording drafted.");
      if (
        (
          await db
            .select({ id: learningPublication.id })
            .from(learningPublication)
            .where(
              and(
                eq(learningPublication.sellerId, owner.sellerId),
                eq(learningPublication.reviewId, review.id),
                eq(learningPublication.findingIndex, input.draft.findingIndex),
              ),
            )
        )[0]
      )
        throw conflict(
          "This finding was published. Edit its shop knowledge instead.",
        );
      const previous = review.editedDrafts.find(
        (draft) => draft.findingIndex === input.draft.findingIndex,
      );
      if (
        review.revision === input.expectedRevision + 1 &&
        previous &&
        sameLearningDraft(previous, input.draft)
      )
        return { revision: review.revision };
      if (review.revision !== input.expectedRevision)
        throw conflict(
          "This review changed in another view. Your edits are still here; copy them before reloading the latest review.",
        );
      if (
        input.draft.productId &&
        !(
          await db
            .select({ id: offer.id })
            .from(offer)
            .where(
              and(
                eq(offer.id, input.draft.productId),
                eq(offer.sellerId, owner.sellerId),
              ),
            )
        )[0]
      )
        throw notFound("product in this shop");
      const ids = new Set(
        input.draft.conflicts.map((conflict) => conflict.guideId),
      );
      if (
        ids.size !== input.draft.conflicts.length ||
        [...ids].some((id) => !finding.conflictingGuideIds.includes(id))
      )
        throw invalid("The draft refers to a conflict outside this review.");
      if (previous && sameLearningDraft(previous, input.draft))
        return { revision: review.revision };
      const editedDrafts = [
          ...review.editedDrafts.filter(
            (draft) => draft.findingIndex !== input.draft.findingIndex,
          ),
          input.draft,
        ].sort((a, b) => a.findingIndex - b.findingIndex),
        revision = review.revision + 1,
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:draft`,
            sql`${ownerScope(owner)} and exists(select 1 from learning_review where id=${review.id} and seller_id=${owner.sellerId} and revision=${review.revision} and state='draft') and not exists(select 1 from learning_publication where review_id=${review.id} and finding_index=${input.draft.findingIndex}) and ${input.draft.productId ? sql`exists(select 1 from offer where id=${input.draft.productId} and seller_id=${owner.sellerId})` : sql`1`}`,
          ),
          db
            .update(learningReview)
            .set({ editedDrafts, revision })
            .where(eq(learningReview.id, review.id)),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "learning_review.edit",
              targetType: "learning_review",
              targetId: review.id,
              outcome: "ok",
              details: { findingIndex: input.draft.findingIndex, revision },
            }),
          clearBatchGuards(db, execution),
        ]);
        return { revision };
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This review changed in another view. Your edits are still here; copy them before reloading the latest review.",
          );
        throw error;
      }
    },
  };
}
