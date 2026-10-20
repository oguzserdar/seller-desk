import { getStorage } from "@/server/storage";
/** Owner-scoped draft persistence, separate from public knowledge and model generation. */
import {
  SaveLearningDraftInput,
  sameLearningDraft,
} from "@/lib/learning-draft";
import { getDb, transaction } from "@/server/db/client";
import {
  learningPublication,
  learningReview,
  offer,
  seller,
} from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";

/** Saves one private finding edit; stale/replayed requests cannot overwrite newer wording. */
export async function saveLearningDraft(
  owner: OwnerPrincipal,
  raw: SaveLearningDraftInput,
): Promise<{ revision: number }> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.saveLearningDraft(owner, raw);

  const input = SaveLearningDraftInput.parse(raw);
  return transaction(getDb(), async (tx) => {
    const [shop] = await tx
      .select({ id: seller.id })
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      )
      .for("update");
    if (!shop) throw notFound("shop");
    const [review] = await tx
      .select()
      .from(learningReview)
      .where(
        and(
          eq(learningReview.id, input.reviewId),
          eq(learningReview.sellerId, owner.sellerId),
        ),
      )
      .for("update");
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
    const [published] = await tx
      .select({ id: learningPublication.id })
      .from(learningPublication)
      .where(
        and(
          eq(learningPublication.sellerId, owner.sellerId),
          eq(learningPublication.reviewId, review.id),
          eq(learningPublication.findingIndex, input.draft.findingIndex),
        ),
      );
    if (published)
      throw conflict(
        "This finding was published. Edit its shop knowledge instead.",
      );
    const previous = review.editedDrafts.find(
      (d) => d.findingIndex === input.draft.findingIndex,
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
    if (input.draft.productId) {
      const [product] = await tx
        .select({ id: offer.id })
        .from(offer)
        .where(
          and(
            eq(offer.id, input.draft.productId),
            eq(offer.sellerId, owner.sellerId),
          ),
        );
      if (!product) throw notFound("product in this shop");
    }
    const ids = new Set(input.draft.conflicts.map((c) => c.guideId));
    if (
      ids.size !== input.draft.conflicts.length ||
      [...ids].some((id) => !finding.conflictingGuideIds.includes(id))
    )
      throw invalid("The draft refers to a conflict outside this review.");
    if (previous && sameLearningDraft(previous, input.draft))
      return { revision: review.revision };
    const editedDrafts = [
      ...review.editedDrafts.filter(
        (d) => d.findingIndex !== input.draft.findingIndex,
      ),
      input.draft,
    ].sort((a, b) => a.findingIndex - b.findingIndex);
    const revision = review.revision + 1;
    await tx
      .update(learningReview)
      .set({ editedDrafts, revision })
      .where(
        and(
          eq(learningReview.id, review.id),
          eq(learningReview.sellerId, owner.sellerId),
        ),
      );
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "learning_review.edit",
      targetType: "learning_review",
      targetId: review.id,
      outcome: "ok",
      details: { findingIndex: input.draft.findingIndex, revision },
    });
    return { revision };
  });
}
