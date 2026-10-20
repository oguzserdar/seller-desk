import {
  changedFindingConflicts,
  sourceWithPublications,
} from "@/lib/learning-publication";
import {
  validateLearningAnalysis,
  type LearningSource,
  type LearningWorkspaceItem,
} from "@/lib/learning-review";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import { auditEvent } from "@/server/db/sqlite/operations";
import {
  learningPublication,
  learningReview,
  seller,
  sellerQuestion,
} from "@/server/db/sqlite/schema";
import { conflict, notFound } from "@/server/domain/errors";
import {
  LearningDecision,
  learningSourceHash,
  type LearningClaim,
  type LearningReviewRow,
} from "@/server/domain/learning-review";
import type { OwnerPrincipal } from "@/server/domain/principal";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import {
  captureD1LearningSource,
  d1LearningFacts,
  d1LearningFactsQueries,
} from "./learning-source";

/** Proves current owner identity before private learning reads or writes. */
export async function assertD1LearningOwner(db: D1Db, owner: OwnerPrincipal) {
  const [shop] = await db
    .select()
    .from(seller)
    .where(and(eq(seller.id, owner.sellerId), ownerScope(owner)));
  if (!shop) throw notFound("shop");
  return shop;
}

/** Native private reviews retain immutable sources and revocable generation claims. */
export function createD1LearningReviews(db: D1Db) {
  return {
    async learningSource(
      owner: OwnerPrincipal,
      id: string,
    ): Promise<LearningSource> {
      z.uuid().parse(id);
      return (await captureD1LearningSource(db, owner, id)).source;
    },
    async claimLearningReview(
      owner: OwnerPrincipal,
      source: LearningSource,
    ): Promise<
      | { state: "ready"; review: LearningReviewRow }
      | { state: "claimed"; claim: LearningClaim; dailyLimit: number }
    > {
      const current = await captureD1LearningSource(
          db,
          owner,
          source.questionId,
        ),
        hash = learningSourceHash(source);
      if (learningSourceHash(current.source) !== hash)
        throw conflict(
          "The source changed. Reload this answer before reviewing it.",
        );
      const [existing] = await db
        .select()
        .from(learningReview)
        .where(
          and(
            eq(learningReview.sellerId, owner.sellerId),
            eq(learningReview.questionId, source.questionId),
            eq(learningReview.sourceHash, hash),
          ),
        );
      if (existing) return { state: "ready", review: existing };
      const id = crypto.randomUUID(),
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:review`,
            sql`${current.guard} and exists(select 1 from seller_question where id=${source.questionId} and (review_claim_id is null or review_claim_expires_at<=${nowMilliseconds})) and not exists(select 1 from learning_review where seller_id=${owner.sellerId} and question_id=${source.questionId} and source_hash=${hash})`,
          ),
          db
            .update(sellerQuestion)
            .set({
              reviewClaimId: id,
              reviewClaimExpiresAt: sql`${nowMilliseconds}+120000`,
            })
            .where(eq(sellerQuestion.id, source.questionId)),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const fresh = await captureD1LearningSource(
            db,
            owner,
            source.questionId,
          );
          if (learningSourceHash(fresh.source) !== hash)
            throw conflict(
              "The source changed. Reload this answer before reviewing it.",
            );
          const [saved] = await db
            .select()
            .from(learningReview)
            .where(
              and(
                eq(learningReview.sellerId, owner.sellerId),
                eq(learningReview.questionId, source.questionId),
                eq(learningReview.sourceHash, hash),
              ),
            );
          if (saved) return { state: "ready", review: saved };
          throw conflict(
            "This answer is already being reviewed. Wait for that review before trying again.",
          );
        }
        throw error;
      }
      return {
        state: "claimed",
        claim: { questionId: source.questionId, id },
        dailyLimit: current.shop.sellerDailyAiTurns,
      };
    },
    async releaseLearningClaim(
      owner: OwnerPrincipal,
      claim: LearningClaim,
    ): Promise<void> {
      await assertD1LearningOwner(db, owner);
      await db
        .update(sellerQuestion)
        .set({ reviewClaimId: null, reviewClaimExpiresAt: null })
        .where(
          and(
            eq(sellerQuestion.id, claim.questionId),
            eq(sellerQuestion.sellerId, owner.sellerId),
            eq(sellerQuestion.reviewClaimId, claim.id),
            ownerScope(owner),
          ),
        );
    },
    async saveLearningReview(
      owner: OwnerPrincipal,
      source: LearningSource,
      rawAnalysis: unknown,
      generator: string,
      claim: LearningClaim,
    ): Promise<LearningReviewRow> {
      z.uuid().parse(source.questionId);
      const current = await captureD1LearningSource(
          db,
          owner,
          source.questionId,
        ),
        hash = learningSourceHash(source);
      if (learningSourceHash(current.source) !== hash)
        throw conflict(
          "The seller answer or shop knowledge changed. Generate a new review from the current facts.",
        );
      const analysis = validateLearningAnalysis(current.source, rawAnalysis);
      const [existing] = await db
        .select()
        .from(learningReview)
        .where(
          and(
            eq(learningReview.sellerId, owner.sellerId),
            eq(learningReview.questionId, source.questionId),
            eq(learningReview.sourceHash, hash),
          ),
        );
      if (existing) return existing;
      if (claim.questionId !== source.questionId)
        throw conflict("This review generation no longer owns the answer.");
      const id = crypto.randomUUID(),
        execution = crypto.randomUUID();
      try {
        const [, , rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:save`,
            sql`${current.guard} and exists(select 1 from seller_question where id=${claim.questionId} and review_claim_id=${claim.id} and review_claim_expires_at>${nowMilliseconds}) and not exists(select 1 from learning_review where seller_id=${owner.sellerId} and question_id=${source.questionId} and source_hash=${hash})`,
          ),
          db
            .update(sellerQuestion)
            .set({ reviewClaimId: null, reviewClaimExpiresAt: null })
            .where(eq(sellerQuestion.id, source.questionId)),
          db
            .insert(learningReview)
            .values({
              id,
              sellerId: owner.sellerId,
              questionId: source.questionId,
              sourceHash: hash,
              source: current.source,
              analysis,
              generator: z.string().min(1).max(200).parse(generator),
            })
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "assistant",
              actorId: owner.userId,
              operation: "learning_review.draft",
              targetType: "learning_review",
              targetId: id,
              outcome: "ok",
              details: { findings: analysis.findings.length },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This review generation expired, was replaced, or its source changed. Reload the answer.",
          );
        throw error;
      }
    },
    async listLearningReviews(
      owner: OwnerPrincipal,
    ): Promise<LearningReviewRow[]> {
      await assertD1LearningOwner(db, owner);
      return db
        .select()
        .from(learningReview)
        .where(eq(learningReview.sellerId, owner.sellerId))
        .orderBy(desc(learningReview.createdAt), desc(learningReview.id))
        .limit(50);
    },
    async answersToTeach(owner: OwnerPrincipal): Promise<number> {
      await assertD1LearningOwner(db, owner);
      const [row] = await db
        .select({ n: count() })
        .from(sellerQuestion)
        .where(
          and(
            eq(sellerQuestion.sellerId, owner.sellerId),
            isNotNull(sellerQuestion.answer),
            ne(sellerQuestion.state, "open"),
            sql`not exists(select 1 from learning_review r where r.question_id=${sellerQuestion.id})`,
          ),
        );
      return row?.n ?? 0;
    },
    async learningWorkspace(
      owner: OwnerPrincipal,
    ): Promise<LearningWorkspaceItem[]> {
      const recent = db
        .select({ id: sellerQuestion.id })
        .from(sellerQuestion)
        .where(
          and(
            eq(sellerQuestion.sellerId, owner.sellerId),
            isNotNull(sellerQuestion.answer),
            ne(sellerQuestion.state, "open"),
          ),
        )
        .orderBy(desc(sellerQuestion.updatedAt), desc(sellerQuestion.id))
        .limit(50);
      const latest = and(
        eq(learningReview.sellerId, owner.sellerId),
        inArray(learningReview.questionId, recent),
        sql`not exists(select 1 from learning_review later where later.question_id=learning_review.question_id and later.seller_id=learning_review.seller_id and (later.created_at>learning_review.created_at or (later.created_at=learning_review.created_at and later.id>learning_review.id)))`,
      );
      const [shops, products, guides, answers, reviews, publications] =
        await db.batch([
          ...d1LearningFactsQueries(db, owner),
          db
            .select()
            .from(sellerQuestion)
            .where(
              and(
                eq(sellerQuestion.sellerId, owner.sellerId),
                inArray(sellerQuestion.id, recent),
                ownerScope(owner),
              ),
            )
            .orderBy(desc(sellerQuestion.updatedAt), desc(sellerQuestion.id)),
          db
            .select()
            .from(learningReview)
            .where(and(latest, ownerScope(owner))),
          db
            .select()
            .from(learningPublication)
            .where(
              and(
                eq(learningPublication.sellerId, owner.sellerId),
                inArray(
                  learningPublication.reviewId,
                  db
                    .select({ id: learningReview.id })
                    .from(learningReview)
                    .where(latest),
                ),
                ownerScope(owner),
              ),
            )
            .orderBy(
              asc(learningPublication.createdAt),
              asc(learningPublication.guideRevision),
            ),
        ]);
      const shop = shops[0];
      if (!shop) throw notFound("shop");
      if (!answers.length) return [];
      const facts = d1LearningFacts(shop, products, guides),
        byQuestion = new Map(
          reviews.map((review) => [review.questionId, review]),
        );
      return answers.map((answer) => {
        const review = byQuestion.get(answer.id),
          approved = review
            ? publications.filter((row) => row.reviewId === review.id)
            : [];
        const current: LearningSource = {
          questionId: answer.id,
          sourceRevision: answer.revision,
          question: answer.question,
          customerGoal: answer.customerGoal,
          knownFacts: answer.knownFacts,
          answer: answer.answer!,
          ...facts,
        };
        return {
          questionId: answer.id,
          question: answer.question,
          answer: answer.answer!,
          customerGoal: answer.customerGoal,
          review: review
            ? {
                id: review.id,
                revision: review.revision,
                state: review.state,
                stale:
                  learningSourceHash(
                    sourceWithPublications(review.source, approved),
                  ) !== learningSourceHash(current) ||
                  changedFindingConflicts(
                    review.analysis,
                    review.source,
                    current,
                    approved,
                  ),
                analysis: review.analysis,
                source: review.source,
                editedDrafts: review.editedDrafts,
                publications: approved.map((row) => ({
                  id: row.id,
                  findingIndex: row.findingIndex,
                  guideId: row.guideId,
                  guideRevision: row.guideRevision,
                  title: row.publicSource.title,
                  body: row.publicSource.body,
                  current: guides.some(
                    (guide) =>
                      guide.id === row.guideId &&
                      guide.revision === row.guideRevision,
                  ),
                })),
              }
            : null,
        };
      });
    },
    async decideLearningReview(
      owner: OwnerPrincipal,
      raw: z.infer<typeof LearningDecision>,
    ): Promise<LearningReviewRow> {
      const input = LearningDecision.parse(raw);
      await assertD1LearningOwner(db, owner);
      const [current] = await db
        .select()
        .from(learningReview)
        .where(
          and(
            eq(learningReview.id, input.id),
            eq(learningReview.sellerId, owner.sellerId),
          ),
        );
      if (!current) throw notFound("review");
      if (current.revision !== input.expectedRevision)
        throw conflict("This review changed. Reload it before deciding.");
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:decision`,
            sql`${ownerScope(owner)} and exists(select 1 from learning_review where id=${input.id} and seller_id=${owner.sellerId} and revision=${input.expectedRevision})`,
          ),
          db
            .update(learningReview)
            .set({ state: input.state, revision: current.revision + 1 })
            .where(eq(learningReview.id, input.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "learning_review.decide",
              targetType: "learning_review",
              targetId: input.id,
              outcome: "ok",
              details: { state: input.state, revision: current.revision + 1 },
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict("This review changed. Reload it before deciding.");
        throw error;
      }
    },
  };
}
