/** Private comparison of current public facts with one saved public draft. */
import { z } from "zod";
import type { LearningSource } from "./learning-review";

/** A request names a stored draft, never supplies replacement shop records or approval. */
export const LearningPreviewInput = z.object({
  requestId: z.uuid(), reviewId: z.uuid(), expectedRevision: z.number().int().positive(),
  findingIndex: z.number().int().min(0).max(5), question: z.string().trim().min(5).max(1000),
}).strict();
/** Parsed owner request. */
export type LearningPreviewInput = z.infer<typeof LearningPreviewInput>;
/** Only facts already public to buyers; private answers/clarifications never enter this snapshot. */
export type PreviewFacts = Pick<LearningSource, "terms" | "products" | "guides">;
/** Actual generated answer and measured usage, never a synthetic successful response. */
export const PreviewAnswer = z.object({
  text: z.string().trim().min(1).max(8000), latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  reads: z.array(z.literal("read_shop_facts")).min(1).max(4),
}).strict();
/** Parsed result saved only after a completed real-model call. */
export type PreviewAnswer = z.infer<typeof PreviewAnswer>;
/** Durable private report shown after reload; it never grants permission to publish. */
export type LearningPreviewView = {
  id: string; reviewId: string; reviewRevision: number; findingIndex: number; question: string;
  draftBody: string; generator: string; state: "running" | "completed" | "failed";
  current: PreviewAnswer | null; proposed: PreviewAnswer | null; failure: string | null;
  createdAt: string;
};
