import { getStorage } from "@/server/storage";
/** Publishes only owner-reviewed reusable facts, atomically with source provenance. */
import {
  changedFindingConflicts,
  PublishLearningInput,
  sourceWithPublications,
} from "@/lib/learning-publication";
import { coveredBy } from "@/lib/learning-review";
import { getDb, transaction } from "@/server/db/client";
import {
  learningPublication,
  learningReview,
  seller,
  shopGuide,
} from "@/server/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import { learningSourceHash, sourceInTransaction } from "./learning-review";
import type { OwnerPrincipal } from "./principal";
import { saveGuideInTransaction } from "./shop-guide";

function comparable(input: PublishLearningInput) {
  return JSON.stringify([
    input.reviewId,
    input.expectedRevision,
    input.findingIndex,
    input.title,
    input.body,
    input.topic,
    input.productId,
    input.validUntil,
    input.confirmReusable,
    input.clarification,
    [...input.conflicts]
      .sort((a, b) => a.guideId.localeCompare(b.guideId))
      .map((item) => [item.guideId, item.resolution, item.reason]),
  ]);
}

/** Approves one finding; exact retries return its original version without republishing it. */
export async function publishLearningFinding(
  owner: OwnerPrincipal,
  raw: PublishLearningInput,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.publishLearningFinding(owner, raw);

  const input = PublishLearningInput.parse(raw);
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
    const publications = await tx
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
    const saved = publications.find(
      (row) => row.findingIndex === input.findingIndex,
    );
    if (saved) {
      if (comparable(saved.approvedInput) !== comparable(input))
        throw conflict(
          "This finding was already approved with different wording. Edit its saved shop knowledge instead.",
        );
      return saved;
    }
    if (review.state !== "draft" || review.revision !== input.expectedRevision)
      throw conflict(
        "This review changed. Reopen or reload it before approving a fact.",
      );
    const current = await sourceInTransaction(owner, review.questionId, tx);
    if (
      learningSourceHash(current) !==
        learningSourceHash(
          sourceWithPublications(review.source, publications),
        ) ||
      changedFindingConflicts(
        review.analysis,
        review.source,
        current,
        publications,
      )
    )
      throw conflict(
        "The answer or shop knowledge changed. Review the current answer before publishing.",
      );
    const finding = review.analysis.findings[input.findingIndex];
    if (
      !finding ||
      !["reusable_fact", "product_rule", "temporary_information"].includes(
        finding.kind,
      )
    )
      throw invalid(
        "Private exceptions and unresolved problems cannot become public shop knowledge.",
      );
    if (coveredBy(finding).length)
      throw invalid(
        "Your shop knowledge already says this. Edit that entry instead if it needs to change.",
      );
    if (
      finding.conflictingPolicyFields.length ||
      finding.conflictingProductIds.length
    )
      throw invalid(
        "This fact conflicts with checkout terms or a product listing. Correct the source information, then review this answer again.",
      );
    if (finding.kind === "product_rule" && !input.productId)
      throw invalid("Choose the product this rule applies to.");
    if (finding.kind === "temporary_information" && !input.validUntil)
      throw invalid("Choose when this temporary information expires.");
    if (finding.questions.length && input.clarification.length < 5)
      throw invalid("Answer the open questions before publishing this fact.");
    const conflicts = new Set(finding.conflictingGuideIds);
    if (
      input.conflicts.length !== conflicts.size ||
      new Set(input.conflicts.map((item) => item.guideId)).size !==
        conflicts.size ||
      input.conflicts.some((item) => !conflicts.has(item.guideId))
    )
      throw invalid(
        "Decide what happens to each conflicting rule before publishing.",
      );
    const replacements = input.conflicts.filter(
      (item) => item.resolution === "replace",
    );
    if (replacements.length > 1)
      throw invalid(
        "Replace one existing rule at a time. Explain why any other rules still apply.",
      );
    const replace = replacements[0]
      ? current.guides.find((guide) => guide.id === replacements[0]!.guideId)
      : undefined;
    if (replacements.length && !replace)
      throw conflict("The rule to replace changed. Review the current answer.");
    const existing = replace
      ? (
          await tx
            .select()
            .from(shopGuide)
            .where(
              and(
                eq(shopGuide.id, replace.id),
                eq(shopGuide.sellerId, owner.sellerId),
              ),
            )
        )[0]
      : undefined;
    const guide = await saveGuideInTransaction(
      owner,
      {
        ...(replace
          ? { id: replace.id, expectedRevision: replace.revision }
          : {}),
        title: input.title,
        body: input.body,
        topic: input.topic,
        productId: input.productId,
        validUntil: input.validUntil,
        published: true,
        actionLabel: existing?.actionLabel ?? "",
        actionUrl: existing?.actionUrl ?? "",
      },
      tx,
    );
    const publicSource = {
      id: guide.id,
      revision: guide.revision,
      title: guide.title,
      body: guide.body,
      topic: guide.topic,
      productId: guide.productId,
      validUntil: guide.validUntil?.toISOString() ?? null,
    };
    const [result] = await tx
      .insert(learningPublication)
      .values({
        sellerId: owner.sellerId,
        reviewId: review.id,
        findingIndex: input.findingIndex,
        guideId: guide.id,
        guideRevision: guide.revision,
        approvedInput: input,
        publicSource,
      })
      .returning();
    if (!result) throw new Error("learning publication returned nothing");
    await tx
      .update(learningReview)
      .set({ revision: review.revision + 1 })
      .where(
        and(
          eq(learningReview.id, review.id),
          eq(learningReview.sellerId, owner.sellerId),
        ),
      );
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "learning_review.publish",
      targetType: "learning_review",
      targetId: review.id,
      outcome: "ok",
      details: {
        findingIndex: input.findingIndex,
        guideId: guide.id,
        guideRevision: guide.revision,
      },
    });
    return result;
  });
}
