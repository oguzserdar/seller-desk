/** Owner approval contracts; evidence and explanations stay private. */
import { z } from "zod";
import { GUIDE_TOPICS } from "./shop-guide";
import type { LearningAnalysis, LearningSource } from "./learning-review";

/** Explicit public wording and resolution of every model-identified conflict. */
export const PublishLearningInput = z.object({
  reviewId: z.uuid(), expectedRevision: z.number().int().positive(), findingIndex: z.number().int().min(0).max(5),
  title: z.string().trim().min(3).max(100), body: z.string().trim().min(10).max(2000), topic: z.enum(GUIDE_TOPICS),
  productId: z.uuid().nullable(), validUntil: z.iso.datetime({ offset: true }).nullable(),
  confirmReusable: z.literal(true), clarification: z.string().trim().max(1000),
  conflicts: z.array(z.object({ guideId: z.uuid(), resolution: z.enum(["replace", "keep"]), reason: z.string().trim().min(5).max(500) }).strict()).max(24),
}).strict();
/** Values bound to one approved finding; replay requires the same content. */
export type PublishLearningInput = z.infer<typeof PublishLearningInput>;
/** Safe owner result; publication is historical if the guide subsequently changes. */
export type LearningPublicationView = { id: string; findingIndex: number; guideId: string; guideRevision: number; title: string; body: string; current: boolean };

/** Includes this review's own committed changes without accepting unrelated knowledge edits. */
export function sourceWithPublications(source: LearningSource, publications: { publicSource: LearningSource["guides"][number] }[]): LearningSource {
  const guides = new Map(source.guides.map(guide => [guide.id, guide]));
  for (const publication of publications) guides.set(publication.publicSource.id, publication.publicSource);
  return { ...source, guides: [...guides.values()] };
}

/** A remaining finding must not resolve a conflict against wording the seller has never reviewed. */
export function changedFindingConflicts(analysis: LearningAnalysis, source: LearningSource, current: LearningSource, publications: { findingIndex: number }[]): boolean {
  const approved = new Set(publications.map(item => item.findingIndex));
  return analysis.findings.some((finding, index) => !approved.has(index) && finding.conflictingGuideIds.some(id =>
    source.guides.find(guide => guide.id === id)?.revision !== current.guides.find(guide => guide.id === id)?.revision));
}
