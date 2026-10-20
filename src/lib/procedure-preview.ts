import { z } from "zod";
import type { ProcedureContent } from "./assistant-procedure";
import type { PreviewAnswer } from "./learning-preview";

/** Names an exact saved instruction and one fictional customer question. */
export const ProcedurePreviewInput = z.object({
  requestId: z.uuid(), procedureId: z.uuid(), expectedRevision: z.number().int().positive(),
  question: z.string().trim().min(5).max(1000),
}).strict();
/** Validated private comparison request; no shop facts can be supplied by the caller. */
export type ProcedurePreviewInput = z.infer<typeof ProcedurePreviewInput>;
/** A durable answer comparison, without internal shop/customer snapshots. */
export type ProcedurePreviewView = {
  id: string; procedureId: string; revision: number; publishedRevision: number | null;
  question: string; wording: ProcedureContent; generator: string;
  state: "running" | "completed" | "failed"; current: PreviewAnswer | null;
  proposed: PreviewAnswer | null; failure: string | null; createdAt: string;
};
