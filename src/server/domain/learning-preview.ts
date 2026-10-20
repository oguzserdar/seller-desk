import { getStorage } from "@/server/storage";
/** Owner-scoped preview records. Knowledge, customer conversations and commerce are never mutated. */
import {
  LearningPreviewInput,
  PreviewAnswer,
  type LearningPreviewView,
  type PreviewFacts,
} from "@/lib/learning-preview";
import {
  changedFindingConflicts,
  PublishLearningInput,
  sourceWithPublications,
} from "@/lib/learning-publication";
import { getDb, transaction, type Queryable } from "@/server/db/client";
import {
  learningPreview,
  learningPublication,
  learningReview,
  seller,
} from "@/server/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, invalid, notFound } from "./errors";
import { learningSourceHash, sourceInTransaction } from "./learning-review";
import type { OwnerPrincipal } from "./principal";

/** Internal persisted comparison, including immutable model inputs. */
export type LearningPreviewRow = typeof learningPreview.$inferSelect;
const Wording = PublishLearningInput.omit({
  reviewId: true,
  expectedRevision: true,
  confirmReusable: true,
});

async function ownerShop(owner: OwnerPrincipal, db: Queryable, lock = false) {
  const query = db
    .select()
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [shop] = await (lock ? query.for("update") : query);
  if (!shop) throw notFound("shop");
  return shop;
}

/** Reserves one bounded comparison, reusing an exact retry rather than paying for another model run. */
export async function claimLearningPreview(
  owner: OwnerPrincipal,
  raw: LearningPreviewInput,
  generator: string,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.claimLearningPreview(owner, raw, generator);

  const input = LearningPreviewInput.parse(raw);
  z.string().min(1).max(200).parse(generator);
  return transaction(getDb(), async (tx) => {
    const shop = await ownerShop(owner, tx, true);
    const [existing] = await tx
      .select()
      .from(learningPreview)
      .where(eq(learningPreview.id, input.requestId));
    if (existing) {
      if (existing.sellerId !== owner.sellerId) throw notFound("preview");
      if (
        existing.reviewId !== input.reviewId ||
        existing.reviewRevision !== input.expectedRevision ||
        existing.findingIndex !== input.findingIndex ||
        existing.question !== input.question
      )
        throw conflict(
          "This preview request was already used for a different question or draft.",
        );
      return {
        created: false,
        row: existing,
        dailyLimit: shop.sellerDailyAiTurns,
      };
    }
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
    if (review.state !== "draft" || review.revision !== input.expectedRevision)
      throw conflict(
        "This review changed. Reload its saved draft before trying an answer.",
      );
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
    if (publications.some((p) => p.findingIndex === input.findingIndex))
      throw conflict(
        "This fact is already published. Its earlier previews remain in your records.",
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
    const saved = review.editedDrafts.find(
      (d) => d.findingIndex === input.findingIndex,
    );
    const parsed = Wording.safeParse(saved);
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
        !current.products.some((p) => p.id === draft.productId))
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
      new Set(draft.conflicts.map((c) => c.guideId)).size !==
        draft.conflicts.length ||
      draft.conflicts.some(
        (c) => !finding.conflictingGuideIds.includes(c.guideId),
      )
    )
      throw invalid("Resolve every identified knowledge conflict first.");
    const replacements = draft.conflicts
      .filter((c) => c.resolution === "replace")
      .map((c) => c.guideId);
    if (replacements.length > 1)
      throw invalid("Replace one existing rule at a time.");
    const currentFacts: PreviewFacts = {
      terms: current.terms,
      products: current.products,
      guides: current.guides,
    };
    const proposedFacts: PreviewFacts = {
      ...currentFacts,
      guides: [
        ...current.guides.filter((g) => !replacements.includes(g.id)),
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
    // A terminated host leaves an explicit failed record, never an invented result.
    await tx
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
          sql`${learningPreview.expiresAt} <= now()`,
        ),
      );
    const [active] = await tx
      .select({ id: learningPreview.id })
      .from(learningPreview)
      .where(
        and(
          eq(learningPreview.sellerId, owner.sellerId),
          eq(learningPreview.state, "running"),
        ),
      );
    if (active)
      throw conflict(
        "A comparison is already running. Wait for it to finish before starting another.",
      );
    const [row] = await tx
      .insert(learningPreview)
      .values({
        id: input.requestId,
        sellerId: owner.sellerId,
        reviewId: review.id,
        reviewRevision: review.revision,
        findingIndex: input.findingIndex,
        question: input.question,
        sourceHash: learningSourceHash(current),
        draftBody: draft.body,
        currentFacts,
        proposedFacts,
        generator,
        expiresAt: new Date(Date.now() + 120_000),
      })
      .returning();
    if (!row) throw new Error("preview insert returned nothing");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "learning_preview.start",
      targetType: "learning_preview",
      targetId: row.id,
      outcome: "ok",
      details: { reviewId: review.id, findingIndex: input.findingIndex },
    });
    return { created: true, row, dailyLimit: shop.sellerDailyAiTurns };
  });
}

/** Stores each actual answer independently so a later provider failure cannot erase the first result. */
export async function savePreviewAnswer(
  owner: OwnerPrincipal,
  id: string,
  side: "current" | "proposed",
  raw: PreviewAnswer,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.savePreviewAnswer(owner, id, side, raw);

  const answer = PreviewAnswer.parse(raw);
  z.uuid().parse(id);
  return transaction(getDb(), async (tx) => {
    await ownerShop(owner, tx, true);
    const [row] = await tx
      .select()
      .from(learningPreview)
      .where(
        and(
          eq(learningPreview.id, id),
          eq(learningPreview.sellerId, owner.sellerId),
        ),
      )
      .for("update");
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
    const [saved] = await tx
      .update(learningPreview)
      .set(
        side === "current"
          ? { currentAnswer: answer }
          : { proposedAnswer: answer, state: "completed" },
      )
      .where(eq(learningPreview.id, row.id))
      .returning();
    await recordAudit(tx, {
      actor: "assistant",
      actorId: owner.userId,
      operation: "learning_preview.answer",
      targetType: "learning_preview",
      targetId: row.id,
      outcome: "ok",
      details: { side },
    });
    return saved!;
  });
}

/** Records a generic failure, never the provider body or a successful stand-in answer. */
export async function failLearningPreview(
  owner: OwnerPrincipal,
  id: string,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.failLearningPreview(owner, id);

  z.uuid().parse(id);
  await transaction(getDb(), async (tx) => {
    await ownerShop(owner, tx, true);
    await tx
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
        ),
      );
  });
}

/** Shapes an owner report without exposing complete private model input snapshots. */
export function learningPreviewView(
  row: LearningPreviewRow,
): LearningPreviewView {
  const expired = row.state === "running" && row.expiresAt <= new Date();
  return {
    id: row.id,
    reviewId: row.reviewId,
    reviewRevision: row.reviewRevision,
    findingIndex: row.findingIndex,
    question: row.question,
    draftBody: row.draftBody,
    generator: row.generator,
    state: expired ? "failed" : row.state,
    current: row.currentAnswer,
    proposed: row.proposedAnswer,
    failure: expired
      ? "The preview did not finish. Its saved results are still here."
      : row.failure,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Reads the latest private reports only for the authenticated shop owner. */
export async function listLearningPreviews(
  owner: OwnerPrincipal,
): Promise<LearningPreviewView[]> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.learning.listLearningPreviews(owner);

  const db = getDb();
  await ownerShop(owner, db);
  const rows = await db
    .select()
    .from(learningPreview)
    .where(eq(learningPreview.sellerId, owner.sellerId))
    .orderBy(desc(learningPreview.createdAt), desc(learningPreview.id))
    .limit(20);
  return rows.map(learningPreviewView);
}
