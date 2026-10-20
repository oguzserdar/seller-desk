"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GuideInput } from "@/lib/shop-guide";
import { ownerAction } from "@/server/actions/safe-action";
import { removeGuide, saveGuide } from "@/server/domain/shop-guide";

/** Saves only content explicitly reviewed by the authenticated shop owner. */
export const saveGuideAction = ownerAction.inputSchema(GuideInput).action(async ({ parsedInput, ctx }) => {
  const entry = await saveGuide(ctx.owner, parsedInput);
  revalidatePath("/owner/knowledge");
  return { id: entry.id, revision: entry.revision, published: entry.published };
});

/** Removes a versioned entry and all future access to its destination. */
export const removeGuideAction = ownerAction.inputSchema(z.object({ id: z.uuid(), expectedRevision: z.number().int().positive() }).strict())
  .action(async ({ parsedInput, ctx }) => {
    await removeGuide(ctx.owner, parsedInput.id, parsedInput.expectedRevision);
    revalidatePath("/owner/knowledge");
    return { removed: true };
  });

/** Loads only the authenticated owner's version history. */
export const guideHistoryAction = ownerAction.inputSchema(z.object({ id: z.uuid() }).strict()).action(async ({ parsedInput, ctx }) => {
  const { guideHistory } = await import("@/server/domain/shop-guide");
  return { id: parsedInput.id, versions: await guideHistory(ctx.owner, parsedInput.id) };
});

/** Restores a historic snapshot into a new draft while rejecting stale decisions. */
export const restoreGuideAction = ownerAction.inputSchema(z.object({ id: z.uuid(), expectedRevision: z.number().int().positive(), restoreRevision: z.number().int().positive() }).strict()).action(async ({ parsedInput, ctx }) => {
  const { restoreGuideVersion } = await import("@/server/domain/shop-guide");
  const row = await restoreGuideVersion(ctx.owner, parsedInput.id, parsedInput.expectedRevision, parsedInput.restoreRevision);
  revalidatePath("/owner/knowledge");
  revalidatePath("/owner/knowledge/reviews");
  return { id: row.id, revision: row.revision };
});
