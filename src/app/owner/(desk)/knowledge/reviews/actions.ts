"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction } from "@/server/actions/safe-action";
import { draftLearningReview } from "@/server/ai/learning-review";
import { decideLearningReview, LearningDecision } from "@/server/domain/learning-review";
import { PublishLearningInput } from "@/lib/learning-publication";
import { publishLearningFinding } from "@/server/domain/learning-publication";
import { SaveLearningDraftInput } from "@/lib/learning-draft";
import { LearningPreviewInput } from "@/lib/learning-preview";
import { runLearningPreview } from "@/server/ai/learning-preview";
import { saveLearningDraft } from "@/server/domain/learning-draft";

/** Saves unfinished wording privately, without approving it for customer answers. */
export const saveReviewDraftAction = ownerAction.inputSchema(SaveLearningDraftInput).action(async ({ parsedInput, ctx }) => {
  const result = await saveLearningDraft(ctx.owner, parsedInput);
  revalidatePath("/owner/knowledge/reviews");
  return result;
});

/** Requests a real-model review of this owner's saved answer; repeated requests reuse its result. */
export const generateReviewAction = ownerAction.inputSchema(z.object({ questionId: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => {
  const review = await draftLearningReview(ctx.owner, parsedInput.questionId);
  revalidatePath("/owner/knowledge/reviews");
  return { id: review.id };
});

/** Records a version-checked private review decision; never publishes buyer knowledge. */
export const decideReviewAction = ownerAction.inputSchema(LearningDecision).action(async ({ parsedInput, ctx }) => {
  const review = await decideLearningReview(ctx.owner, parsedInput);
  revalidatePath("/owner/knowledge/reviews");
  return { id: review.id, state: review.state };
});

/** Publishes owner-approved wording with private provenance and version-checked conflicts. */
export const publishReviewAction = ownerAction.inputSchema(PublishLearningInput).action(async ({ parsedInput, ctx }) => {
  const result = await publishLearningFinding(ctx.owner, parsedInput);
  revalidatePath("/owner/knowledge/reviews");
  revalidatePath("/owner/knowledge");
  return { id: result.id, guideId: result.guideId, guideRevision: result.guideRevision };
});

/** Compares current public knowledge with a saved draft using real AI; never publishes. */
export const previewReviewAction = ownerAction.inputSchema(LearningPreviewInput).action(async ({ parsedInput, ctx }) => {
  const report = await runLearningPreview(ctx.owner, parsedInput);
  revalidatePath("/owner/knowledge/reviews");
  return report;
});
