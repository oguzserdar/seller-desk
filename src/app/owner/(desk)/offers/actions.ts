"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { ownerAction } from "@/server/actions/safe-action";
import { AddDraftsInput, addDraftedOffers, draftFromBusinessText, MAX_SOURCE_CHARS } from "@/server/ai/draft-setup";
import { requireOwnerWrite } from "@/server/auth/owner";
import { MAX_ASSET_BYTES, storeAsset } from "@/server/domain/digital";
import { DomainError } from "@/server/domain/errors";
import { MAX_IMPORT_CHARS } from "@/server/domain/catalog-file";
import { importOfferDrafts, ImportReviewInput, previewOfferImport } from "@/server/domain/offer-import";
import { OfferInput, saveOffer, setOfferPublished } from "@/server/domain/offers";

export const saveOfferAction = ownerAction.inputSchema(OfferInput).action(async ({ parsedInput, ctx }) => {
  const saved = await saveOffer(ctx.owner, ctx.seller, parsedInput);
  revalidatePath("/owner", "layout");
  return { id: saved.id, revision: saved.revision, published: saved.published };
});

export const setPublishedAction = ownerAction
  .inputSchema(z.object({ offerId: z.uuid(), expectedRevision: z.number().int().min(1), published: z.boolean() }).strict())
  .action(async ({ parsedInput, ctx }) => {
    const updated = await setOfferPublished(ctx.owner, ctx.seller, parsedInput);
    revalidatePath("/owner", "layout");
    revalidatePath("/buy");
    return { published: updated.published, revision: updated.revision };
  });

export type UploadResult = { ok: true; id: string; filename: string; sizeBytes: number } | { ok: false; message: string };

/** Stores the file buyers receive for a digital offer. Authorizes inside, like every Server Action. */
export async function uploadAssetAction(form: FormData): Promise<UploadResult> {
  const { owner } = await requireOwnerWrite(await headers());
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to upload." };
  if (file.size > MAX_ASSET_BYTES) return { ok: false, message: "Files can be up to 1 MB in this version." };
  try {
    const stored = await storeAsset(owner, { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { ok: true, id: stored.id, filename: stored.filename, sizeBytes: stored.sizeBytes };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    console.error("asset upload failed", error);
    return { ok: false, message: "The file could not be saved. Try again." };
  }
}

export const previewImportAction = ownerAction.inputSchema(z.object({ text: z.string().max(MAX_IMPORT_CHARS) }).strict())
  .action(async ({ parsedInput, ctx }) => previewOfferImport(ctx.owner, ctx.seller, parsedInput.text));

export const importOffersAction = ownerAction.inputSchema(ImportReviewInput).action(async ({ parsedInput, ctx }) => {
  const result = await importOfferDrafts(ctx.owner, ctx.seller, parsedInput);
  revalidatePath("/owner/offers");
  return result;
});

export const draftFromTextAction = ownerAction
  .inputSchema(z.object({ text: z.string().max(MAX_SOURCE_CHARS) }).strict())
  .action(async ({ parsedInput, ctx }) => draftFromBusinessText(ctx.owner, ctx.seller, parsedInput.text));

export const addDraftsAction = ownerAction.inputSchema(AddDraftsInput).action(async ({ parsedInput, ctx }) => {
  const result = await addDraftedOffers(ctx.owner, ctx.seller, parsedInput);
  revalidatePath("/owner/offers");
  return result;
});
