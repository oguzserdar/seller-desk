import {
  changedFindingConflicts,
  PublishLearningInput,
  sourceWithPublications,
} from "@/lib/learning-publication";
import { coveredBy } from "@/lib/learning-review";
import {
  auditEvent,
  learningPublication,
  learningReview,
  shopGuide,
} from "@/server/db/sqlite/schema";
import { conflict, invalid, notFound } from "@/server/domain/errors";
import { learningSourceHash } from "@/server/domain/learning-review";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, asc, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, isBatchGuardFailure } from "./guards";
import { prepareD1GuideSave } from "./guide-write";
import { assertD1LearningOwner } from "./learning-review";
import { captureD1LearningSource } from "./learning-source";

const comparable = (input: PublishLearningInput) =>
  JSON.stringify([
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
      .map((row) => [row.guideId, row.resolution, row.reason]),
  ]);

/** Native publication commits the approved public fact, immutable provenance and review revision together. */
export function createD1LearningPublication(db: D1Db) {
  return {
    async publishLearningFinding(
      owner: OwnerPrincipal,
      raw: PublishLearningInput,
    ) {
      const input = PublishLearningInput.parse(raw);
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
      if (
        review.state !== "draft" ||
        review.revision !== input.expectedRevision
      )
        throw conflict(
          "This review changed. Reopen or reload it before approving a fact.",
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
        new Set(input.conflicts.map((row) => row.guideId)).size !==
          conflicts.size ||
        input.conflicts.some((row) => !conflicts.has(row.guideId))
      )
        throw invalid(
          "Decide what happens to each conflicting rule before publishing.",
        );
      const replacements = input.conflicts.filter(
        (row) => row.resolution === "replace",
      );
      if (replacements.length > 1)
        throw invalid(
          "Replace one existing rule at a time. Explain why any other rules still apply.",
        );
      const replace = replacements[0]
        ? current.source.guides.find(
            (guide) => guide.id === replacements[0]!.guideId,
          )
        : undefined;
      if (replacements.length && !replace)
        throw conflict(
          "The rule to replace changed. Review the current answer.",
        );
      const [existing] = replace
        ? await db
            .select()
            .from(shopGuide)
            .where(
              and(
                eq(shopGuide.id, replace.id),
                eq(shopGuide.sellerId, owner.sellerId),
              ),
            )
        : [];
      const plan = await prepareD1GuideSave(db, owner, {
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
      });
      const guide = plan.row,
        publicSource = {
          id: guide.id,
          revision: guide.revision,
          title: guide.title,
          body: guide.body,
          topic: guide.topic,
          productId: guide.productId,
          validUntil: guide.validUntil?.toISOString() ?? null,
        };
      const id = crypto.randomUUID(),
        execution = crypto.randomUUID();
      try {
        const results = await db.batch([
          batchGuard(
            db,
            `${execution}:publish`,
            sql`${current.guard} and ${plan.guard} and exists(select 1 from learning_review where id=${review.id} and seller_id=${owner.sellerId} and revision=${input.expectedRevision} and state='draft') and not exists(select 1 from learning_publication where review_id=${review.id} and finding_index=${input.findingIndex})`,
          ),
          ...plan.writes,
          db
            .insert(learningPublication)
            .values({
              id,
              sellerId: owner.sellerId,
              reviewId: review.id,
              findingIndex: input.findingIndex,
              guideId: guide.id,
              guideRevision: guide.revision,
              approvedInput: input,
              publicSource,
            }),
          db
            .update(learningReview)
            .set({ revision: review.revision + 1 })
            .where(eq(learningReview.id, review.id)),
          db
            .insert(auditEvent)
            .values({
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
            }),
          db
            .select()
            .from(learningPublication)
            .where(eq(learningPublication.id, id)),
          clearBatchGuards(db, execution),
        ]);
        return (
          results[
            results.length - 2
          ] as (typeof learningPublication.$inferSelect)[]
        )[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const [receipt] = await db
            .select()
            .from(learningPublication)
            .where(
              and(
                eq(learningPublication.reviewId, review.id),
                eq(learningPublication.findingIndex, input.findingIndex),
                eq(learningPublication.sellerId, owner.sellerId),
              ),
            );
          if (
            receipt &&
            comparable(receipt.approvedInput) === comparable(input)
          )
            return receipt;
          throw conflict(
            "The answer, review or shop knowledge changed. Review the current answer before publishing.",
          );
        }
        throw error;
      }
    },
  };
}
