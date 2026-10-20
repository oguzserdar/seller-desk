import { getStorage } from "@/server/storage";
/** Private review persistence with owner checks and immutable source snapshots. */
import {
  changedFindingConflicts,
  sourceWithPublications,
} from "@/lib/learning-publication";
import {
  validateLearningAnalysis,
  type LearningSource,
  type LearningWorkspaceItem,
} from "@/lib/learning-review";
import { getDb, transaction, type Tx } from "@/server/db/client";
import {
  learningPublication,
  learningReview,
  offer,
  seller,
  sellerQuestion,
  shopGuide,
} from "@/server/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";
import { policySnapshotOf } from "./seller";

/** Owner-private review row; never return this through buyer tools. */
export type LearningReviewRow = typeof learningReview.$inferSelect;
/** Expiring ownership of one seller-answer review generation. */
export type LearningClaim = { questionId: string; id: string };

async function ownerLock(owner: OwnerPrincipal, tx: Tx) {
  const [row] = await tx
    .select()
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    )
    .for("update");
  if (!row) throw notFound("shop");
  return row;
}

async function publishedProducts(
  owner: OwnerPrincipal,
  tx: Tx,
): Promise<LearningSource["products"]> {
  const products = await tx
    .select({
      id: offer.id,
      revision: offer.revision,
      title: offer.title,
      description: offer.description,
      fulfillmentNote: offer.fulfillmentNote,
      serviceScope: offer.serviceScope,
      unitAmountMinor: offer.unitAmountMinor,
      currency: offer.currency,
      accessDays: offer.accessDays,
    })
    .from(offer)
    .where(and(eq(offer.sellerId, owner.sellerId), eq(offer.published, true)))
    .orderBy(asc(offer.id))
    .limit(41);
  if (products.length > 40)
    throw invalid(
      "Answer reviews currently support up to 40 published products.",
    );
  return products;
}

/** Reads published facts under the same owner lock as a saved private comparison. */
export async function publicPreviewFacts(
  owner: OwnerPrincipal,
  tx: Tx,
): Promise<Pick<LearningSource, "terms" | "products" | "guides">> {
  const shop = await ownerLock(owner, tx);
  const guides = await tx
    .select({
      id: shopGuide.id,
      revision: shopGuide.revision,
      title: shopGuide.title,
      body: shopGuide.body,
      topic: shopGuide.topic,
      productId: shopGuide.productId,
      validUntil: shopGuide.validUntil,
    })
    .from(shopGuide)
    .where(
      and(
        eq(shopGuide.sellerId, owner.sellerId),
        eq(shopGuide.published, true),
        eq(shopGuide.archived, false),
        sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil} > now())`,
      ),
    )
    .orderBy(asc(shopGuide.id));
  return {
    terms: policySnapshotOf(shop),
    products: await publishedProducts(owner, tx),
    guides: guides.map((g) => ({
      ...g,
      validUntil: g.validUntil?.toISOString() ?? null,
    })),
  };
}

/** Reads and locks the authorized source inside a larger atomic learning decision. */
export async function sourceInTransaction(
  owner: OwnerPrincipal,
  id: string,
  tx: Tx,
): Promise<LearningSource> {
  const facts = await publicPreviewFacts(owner, tx);
  const [row] = await tx
    .select()
    .from(sellerQuestion)
    .where(
      and(
        eq(sellerQuestion.id, id),
        eq(sellerQuestion.sellerId, owner.sellerId),
      ),
    )
    .for("update");
  if (!row) throw notFound("seller answer");
  if (!row.answer || row.state === "open")
    throw invalid(
      "Answer this customer's question before reviewing what the assistant can learn.",
    );
  return {
    questionId: row.id,
    sourceRevision: row.revision,
    question: row.question,
    customerGoal: row.customerGoal,
    knownFacts: row.knownFacts,
    answer: row.answer,
    ...facts,
  };
}

/** Hashes explicit fields in a stable order, independent of JSONB object key ordering. */
export function learningSourceHash(source: LearningSource): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        source.questionId,
        source.sourceRevision,
        source.question,
        source.customerGoal,
        source.knownFacts,
        source.answer,
        [...source.guides]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((g) => [
            g.id,
            g.revision,
            g.title,
            g.body,
            g.topic,
            g.productId,
            g.validUntil,
          ]),
        source.terms && [
          source.terms.policyRevision,
          source.terms.sellerName,
          source.terms.pickupPolicy,
          source.terms.serviceRequestPolicy,
          source.terms.digitalAccessPolicy,
          source.terms.cancellationPolicy,
          source.terms.taxPolicy,
        ],
        source.products?.map((product) => [
          product.id,
          product.revision,
          product.title,
          product.description,
          product.fulfillmentNote,
          product.serviceScope,
          product.unitAmountMinor,
          product.currency,
          product.accessDays,
        ]),
      ]),
    )
    .digest("hex");
}

/** Reads a consistent, authorized source without altering the answer or public knowledge. */
export async function learningSource(
  owner: OwnerPrincipal,
  questionId: string,
): Promise<LearningSource> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.learningSource(owner, questionId);

  z.uuid().parse(questionId);
  return transaction(getDb(), (tx) =>
    sourceInTransaction(owner, questionId, tx),
  );
}

/** Reuses an existing review for this exact source without making another paid model request. */
export async function claimLearningReview(
  owner: OwnerPrincipal,
  source: LearningSource,
): Promise<
  | { state: "ready"; review: LearningReviewRow }
  | { state: "claimed"; claim: LearningClaim; dailyLimit: number }
> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.claimLearningReview(owner, source);

  return transaction(getDb(), async (tx) => {
    const current = await sourceInTransaction(owner, source.questionId, tx);
    if (learningSourceHash(current) !== learningSourceHash(source))
      throw conflict(
        "The source changed. Reload this answer before reviewing it.",
      );
    const [row] = await tx
      .select()
      .from(learningReview)
      .where(
        and(
          eq(learningReview.sellerId, owner.sellerId),
          eq(learningReview.questionId, source.questionId),
          eq(learningReview.sourceHash, learningSourceHash(source)),
        ),
      );
    if (row) return { state: "ready", review: row };
    const id = crypto.randomUUID();
    const [claimed] = await tx
      .update(sellerQuestion)
      .set({
        reviewClaimId: id,
        reviewClaimExpiresAt: sql`now() + interval '2 minutes'`,
      })
      .where(
        and(
          eq(sellerQuestion.id, source.questionId),
          eq(sellerQuestion.sellerId, owner.sellerId),
          sql`(${sellerQuestion.reviewClaimId} is null or ${sellerQuestion.reviewClaimExpiresAt} <= now())`,
        ),
      )
      .returning({ id: sellerQuestion.id });
    if (!claimed)
      throw conflict(
        "This answer is already being reviewed. Wait for that review before trying again.",
      );
    const [shop] = await tx
      .select({ limit: seller.sellerDailyAiTurns })
      .from(seller)
      .where(eq(seller.id, owner.sellerId));
    return {
      state: "claimed",
      claim: { questionId: source.questionId, id },
      dailyLimit: shop!.limit,
    };
  });
}

/** Releases only this generation, never a replacement worker's claim. */
export async function releaseLearningClaim(
  owner: OwnerPrincipal,
  claim: LearningClaim,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.releaseLearningClaim(owner, claim);

  await transaction(getDb(), async (tx) => {
    await ownerLock(owner, tx);
    await tx
      .update(sellerQuestion)
      .set({ reviewClaimId: null, reviewClaimExpiresAt: null })
      .where(
        and(
          eq(sellerQuestion.id, claim.questionId),
          eq(sellerQuestion.sellerId, owner.sellerId),
          eq(sellerQuestion.reviewClaimId, claim.id),
        ),
      );
  });
}

/** Saves a validated model proposal only while its source and approved knowledge are unchanged. */
export async function saveLearningReview(
  owner: OwnerPrincipal,
  source: LearningSource,
  rawAnalysis: unknown,
  generator: string,
  claim: LearningClaim,
): Promise<LearningReviewRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.saveLearningReview(
      owner,
      source,
      rawAnalysis,
      generator,
      claim,
    );

  z.uuid().parse(source.questionId);
  const sourceHash = learningSourceHash(source);
  return transaction(getDb(), async (tx) => {
    const current = await sourceInTransaction(owner, source.questionId, tx);
    if (learningSourceHash(current) !== sourceHash)
      throw conflict(
        "The seller answer or shop knowledge changed. Generate a new review from the current facts.",
      );
    const analysis = validateLearningAnalysis(current, rawAnalysis);
    const [existing] = await tx
      .select()
      .from(learningReview)
      .where(
        and(
          eq(learningReview.sellerId, owner.sellerId),
          eq(learningReview.questionId, source.questionId),
          eq(learningReview.sourceHash, sourceHash),
        ),
      );
    if (existing) return existing;
    if (claim.questionId !== source.questionId)
      throw conflict("This review generation no longer owns the answer.");
    const [held] = await tx
      .update(sellerQuestion)
      .set({ reviewClaimId: null, reviewClaimExpiresAt: null })
      .where(
        and(
          eq(sellerQuestion.id, claim.questionId),
          eq(sellerQuestion.sellerId, owner.sellerId),
          eq(sellerQuestion.reviewClaimId, claim.id),
          sql`${sellerQuestion.reviewClaimExpiresAt} > now()`,
        ),
      )
      .returning({ id: sellerQuestion.id });
    if (!held)
      throw conflict(
        "This review generation expired or was replaced. Reload the answer.",
      );
    const [row] = await tx
      .insert(learningReview)
      .values({
        sellerId: owner.sellerId,
        questionId: source.questionId,
        sourceHash,
        source: current,
        analysis,
        generator: z.string().min(1).max(200).parse(generator),
      })
      .returning();
    if (!row) throw new Error("learning review save returned nothing");
    await recordAudit(tx, {
      actor: "assistant",
      actorId: owner.userId,
      operation: "learning_review.draft",
      targetType: "learning_review",
      targetId: row.id,
      outcome: "ok",
      details: { findings: analysis.findings.length },
    });
    return row;
  });
}

/** Reads the most recent private reviews only after proving the current owner's identity. */
export async function listLearningReviews(
  owner: OwnerPrincipal,
): Promise<LearningReviewRow[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.learning.listLearningReviews(owner);

  return transaction(getDb(), async (tx) => {
    await ownerLock(owner, tx);
    return tx
      .select()
      .from(learningReview)
      .where(eq(learningReview.sellerId, owner.sellerId))
      .orderBy(desc(learningReview.createdAt), desc(learningReview.id))
      .limit(50);
  });
}

/** Answers the owner gave that were never reviewed for reuse, counted the way the learning page lists them. */
export async function answersToTeach(owner: OwnerPrincipal): Promise<number> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.learning.answersToTeach(owner);

  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(sellerQuestion)
    .where(
      and(
        eq(sellerQuestion.sellerId, owner.sellerId),
        isNotNull(sellerQuestion.answer),
        ne(sellerQuestion.state, "open"),
        sql`not exists (select 1 from ${learningReview} where ${learningReview.questionId} = ${sellerQuestion.id})`,
      ),
    );
  return row?.count ?? 0;
}

/** Loads a bounded review inbox with explicit browser fields and current-source checks. */
export async function learningWorkspace(
  owner: OwnerPrincipal,
): Promise<LearningWorkspaceItem[]> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.learning.learningWorkspace(owner);

  return transaction(getDb(), async (tx) => {
    const shop = await ownerLock(owner, tx);
    const answers = await tx
      .select()
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
    if (!answers.length) return [];
    const products = await publishedProducts(owner, tx);
    const guides = await tx
      .select({
        id: shopGuide.id,
        revision: shopGuide.revision,
        title: shopGuide.title,
        body: shopGuide.body,
        topic: shopGuide.topic,
        productId: shopGuide.productId,
        validUntil: shopGuide.validUntil,
      })
      .from(shopGuide)
      .where(
        and(
          eq(shopGuide.sellerId, owner.sellerId),
          eq(shopGuide.published, true),
          eq(shopGuide.archived, false),
          sql`(${shopGuide.validUntil} is null or ${shopGuide.validUntil} > now())`,
        ),
      )
      .orderBy(asc(shopGuide.id));
    const reviews = await tx
      .selectDistinctOn([learningReview.questionId])
      .from(learningReview)
      .where(
        and(
          eq(learningReview.sellerId, owner.sellerId),
          inArray(
            learningReview.questionId,
            answers.map((answer) => answer.id),
          ),
        ),
      )
      .orderBy(
        learningReview.questionId,
        desc(learningReview.createdAt),
        desc(learningReview.id),
      );
    const byQuestion = new Map(
      reviews.map((review) => [review.questionId, review]),
    );
    const publications = reviews.length
      ? await tx
          .select()
          .from(learningPublication)
          .where(
            and(
              eq(learningPublication.sellerId, owner.sellerId),
              inArray(
                learningPublication.reviewId,
                reviews.map((review) => review.id),
              ),
            ),
          )
          .orderBy(
            asc(learningPublication.createdAt),
            asc(learningPublication.guideRevision),
          )
      : [];
    return answers.map((answer) => {
      const review = byQuestion.get(answer.id);
      const approved = review
        ? publications.filter(
            (publication) => publication.reviewId === review.id,
          )
        : [];
      const current: LearningSource = {
        questionId: answer.id,
        sourceRevision: answer.revision,
        question: answer.question,
        customerGoal: answer.customerGoal,
        knownFacts: answer.knownFacts,
        answer: answer.answer!,
        terms: policySnapshotOf(shop),
        products,
        guides: guides.map((g) => ({
          ...g,
          validUntil: g.validUntil?.toISOString() ?? null,
        })),
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
              publications: approved.map((publication) => ({
                id: publication.id,
                findingIndex: publication.findingIndex,
                guideId: publication.guideId,
                guideRevision: publication.guideRevision,
                title: publication.publicSource.title,
                body: publication.publicSource.body,
                current: guides.some(
                  (guide) =>
                    guide.id === publication.guideId &&
                    guide.revision === publication.guideRevision,
                ),
              })),
            }
          : null,
      };
    });
  });
}

/** Explicit owner decision; source revisions are preserved and publication is unavailable here. */
export const LearningDecision = z
  .object({
    id: z.uuid(),
    expectedRevision: z.number().int().positive(),
    state: z.enum(["draft", "deferred", "rejected"]),
  })
  .strict();

/** Defers, rejects or reopens a private review without changing buyer knowledge. */
export async function decideLearningReview(
  owner: OwnerPrincipal,
  raw: z.infer<typeof LearningDecision>,
): Promise<LearningReviewRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.decideLearningReview(owner, raw);

  const input = LearningDecision.parse(raw);
  return transaction(getDb(), async (tx) => {
    await ownerLock(owner, tx);
    const [current] = await tx
      .select()
      .from(learningReview)
      .where(
        and(
          eq(learningReview.id, input.id),
          eq(learningReview.sellerId, owner.sellerId),
        ),
      )
      .for("update");
    if (!current) throw notFound("review");
    if (current.revision !== input.expectedRevision)
      throw conflict("This review changed. Reload it before deciding.");
    const [row] = await tx
      .update(learningReview)
      .set({ state: input.state, revision: current.revision + 1 })
      .where(
        and(
          eq(learningReview.id, input.id),
          eq(learningReview.sellerId, owner.sellerId),
        ),
      )
      .returning();
    if (!row) throw new Error("learning review decision returned nothing");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "learning_review.decide",
      targetType: "learning_review",
      targetId: row.id,
      outcome: "ok",
      details: { state: row.state, revision: row.revision },
    });
    return row;
  });
}
