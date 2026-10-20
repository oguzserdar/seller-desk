"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SaveProcedureInput, PublishProcedureInput, procedureEditorValue } from "@/lib/assistant-procedure";
import { ownerAction } from "@/server/actions/safe-action";
import { saveProcedure, publishProcedure, pauseProcedure, restoreProcedure, procedureHistory } from "@/server/domain/assistant-procedures";
import { ProcedurePreviewInput } from "@/lib/procedure-preview";
import { runProcedurePreview } from "@/server/ai/procedure-preview";

const target = z.object({ id: z.uuid(), expectedRevision: z.number().int().positive() }).strict();
const refresh = () => revalidatePath("/owner/knowledge/instructions");

/** Compares real replies using one saved version; never approves or publishes it. */
export const previewInstructionAction = ownerAction.inputSchema(ProcedurePreviewInput).action(async ({ parsedInput, ctx }) => {
  const result = await runProcedurePreview(ctx.owner, parsedInput); refresh(); return result;
});

/** Saves a private draft through current owner authorization and version checks. */
export const saveInstructionAction = ownerAction.inputSchema(SaveProcedureInput).action(async ({ parsedInput, ctx }) => {
  const row = await saveProcedure(ctx.owner, parsedInput); refresh(); return procedureEditorValue(row);
});
/** Separately approves exactly the saved version the owner reviewed. */
export const publishInstructionAction = ownerAction.inputSchema(PublishProcedureInput).action(async ({ parsedInput, ctx }) => {
  const row = await publishProcedure(ctx.owner, parsedInput); refresh(); return procedureEditorValue(row);
});
/** Stops live use, optionally archiving the instruction while preserving its versions. */
export const pauseInstructionAction = ownerAction.inputSchema(target.extend({ archive: z.boolean() })).action(async ({ parsedInput, ctx }) => {
  const row = await pauseProcedure(ctx.owner, parsedInput.id, parsedInput.expectedRevision, parsedInput.archive); refresh(); return procedureEditorValue(row);
});
/** Copies a selected immutable version into a new private draft. */
export const restoreInstructionAction = ownerAction.inputSchema(target.extend({ restoreRevision: z.number().int().positive() })).action(async ({ parsedInput, ctx }) => {
  const row = await restoreProcedure(ctx.owner, parsedInput.id, parsedInput.expectedRevision, parsedInput.restoreRevision); refresh(); return procedureEditorValue(row);
});
/** Reads only this owner's saved instruction versions. */
export const instructionHistoryAction = ownerAction.inputSchema(z.object({ id: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => ({
  versions: (await procedureHistory(ctx.owner, parsedInput.id)).map(row => ({ revision: row.revision, content: row.content, savedAt: row.createdAt.toISOString() })),
}));
