/** Private unfinished wording. Saving it never stores publication consent. */
import { z } from "zod";
import { GUIDE_TOPICS } from "./shop-guide";

/** Incomplete fields are allowed, with the same maximum sizes as publication. */
export const LearningDraft = z.object({
  findingIndex: z.number().int().min(0).max(5),
  title: z.string().max(100), body: z.string().max(2000), topic: z.enum(GUIDE_TOPICS),
  productId: z.uuid().nullable(), validUntil: z.iso.datetime({ offset: true }).nullable(),
  clarification: z.string().max(1000),
  conflicts: z.array(z.object({ guideId: z.uuid(), resolution: z.enum(["", "replace", "keep"]), reason: z.string().max(500) }).strict()).max(24),
}).strict();
/** Seller-edited fields, private until a separate explicit publication. */
export type LearningDraft = z.infer<typeof LearningDraft>;
/** The review revision binds the editor to the version the seller opened. */
export const SaveLearningDraftInput = z.object({ reviewId: z.uuid(), expectedRevision: z.number().int().positive(), draft: LearningDraft }).strict();
/** Validated private save request. */
export type SaveLearningDraftInput = z.infer<typeof SaveLearningDraftInput>;

/** Stable comparison for exact retries after a dropped save response. */
export function sameLearningDraft(a: LearningDraft, b: LearningDraft): boolean {
  const value = (d: LearningDraft) => [d.findingIndex, d.title, d.body, d.topic, d.productId, d.validUntil, d.clarification,
    [...d.conflicts].sort((x, y) => x.guideId.localeCompare(y.guideId)).map(c => [c.guideId, c.resolution, c.reason])];
  return JSON.stringify(value(a)) === JSON.stringify(value(b));
}
