/** Owner handling instructions have separate saved and live versions. */
import { z } from "zod";

/** Keeps the combined live instructions small enough for an ordinary seller chat. */
export const PROCEDURE_LIMIT = 6;
/** Plain language guides existing capabilities; it defines no new executable tool. */
export const ProcedureContent = z.object({
  title: z.string().trim().min(3).max(100),
  whenToUse: z.string().trim().min(5).max(300),
  steps: z.string().trim().min(20).max(2000),
}).strict();
/** Immutable wording of one saved handling instruction. */
export type ProcedureContent = z.infer<typeof ProcedureContent>;
/** A new editor allocates its id once; retries reuse that id and saved revision. */
export const SaveProcedureInput = z.object({
  id: z.uuid(), expectedRevision: z.number().int().nonnegative(), content: ProcedureContent,
}).strict();
/** Values submitted when saving a private draft. */
export type SaveProcedureInput = z.infer<typeof SaveProcedureInput>;
/** Explicit approval refers to the exact saved text, not an unsaved replacement. */
export const PublishProcedureInput = z.object({
  id: z.uuid(), expectedRevision: z.number().int().positive(), approve: z.literal(true),
}).strict();
/** Values submitted by the separate publication control. */
export type PublishProcedureInput = z.infer<typeof PublishProcedureInput>;

/** Only the saved wording and version controls needed by the owner editor. */
export type ProcedureEditorValue = {
  id: string; revision: number; publishedRevision: number | null;
  archived: boolean; content: ProcedureContent;
};

/** Keeps database ownership fields and timestamps out of action/page payloads. */
export function procedureEditorValue(row: ProcedureEditorValue): ProcedureEditorValue {
  return { id: row.id, revision: row.revision, publishedRevision: row.publishedRevision, archived: row.archived, content: row.content };
}
