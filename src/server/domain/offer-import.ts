import { getDb, transaction } from "@/server/db/client";
import { importDraft } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readCatalogFile } from "./catalog-file";
import { conflict, notFound } from "./errors";
import { saveOfferInTransaction } from "./offers";
import type { OwnerPrincipal } from "./principal";
import type { SellerRow } from "./seller";

const GENERATOR = "csv-parse:7.0.3:catalog-v1";
const sourceHash = (text: string, currency: string) =>
  createHash("sha256").update(`${currency}\n${text}`).digest("hex");

/** Parses a list without saving it, for validation and import review. */
export function parseOfferList(text: string, currency: string) {
  return readCatalogFile(text, currency).rows;
}

/** A commit accepts only the stored review reference, never replacement product data. */
export const ImportReviewInput = z
  .object({ draftId: z.uuid(), reviewRevision: z.number().int().min(1) })
  .strict();

/** Stores the exact parsed source and currency the authenticated owner is reviewing. */
export async function previewOfferImport(
  owner: OwnerPrincipal,
  seller: SellerRow,
  text: string,
) {
  if (owner.sellerId !== seller.id) throw notFound("shop");
  const parsed = readCatalogFile(text, seller.currency);
  const values = {
    sellerId: owner.sellerId,
    sourceKind: "csv" as const,
    sourceText: text,
    sourceHash: sourceHash(text, seller.currency),
    proposed: [],
    generator: GENERATOR,
  };
  const backend = getStorage();
  const saved =
    backend.kind === "d1"
      ? await backend.imports.saveDraft(owner, values)
      : null;
  const draft = saved
    ? { draftId: saved.id, reviewRevision: saved.reviewRevision }
    : (
        await getDb()
          .insert(importDraft)
          .values(values)
          .returning({
            draftId: importDraft.id,
            reviewRevision: importDraft.reviewRevision,
          })
      )[0];
  if (!draft) throw new Error("Import preview was not saved");
  return { ...draft, ...parsed, currency: seller.currency };
}

/** Atomically adds the reviewed valid records once; every offer remains unpublished. */
export async function importOfferDrafts(
  owner: OwnerPrincipal,
  seller: SellerRow,
  raw: z.input<typeof ImportReviewInput>,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.imports.importOfferDrafts(owner, seller, raw);
  const input = ImportReviewInput.parse(raw);
  if (seller.id !== owner.sellerId) throw notFound("shop");
  return transaction(getDb(), async (db) => {
    const [draft] = await db
      .update(importDraft)
      .set({
        status: "published",
        reviewRevision: sql`${importDraft.reviewRevision} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(importDraft.id, input.draftId),
          eq(importDraft.sellerId, owner.sellerId),
          eq(importDraft.sourceKind, "csv"),
          eq(importDraft.generator, GENERATOR),
          eq(importDraft.status, "draft"),
          eq(importDraft.reviewRevision, input.reviewRevision),
        ),
      )
      .returning();
    if (!draft)
      throw conflict(
        "This preview is unavailable or was already added. Preview your file again.",
      );
    if (sourceHash(draft.sourceText, seller.currency) !== draft.sourceHash)
      throw conflict(
        "The shop currency changed. Preview the file again before adding products.",
      );
    const rows = parseOfferList(draft.sourceText, seller.currency);
    let created = 0;
    for (const row of rows) {
      if (row.problem || row.unitAmountMinor === null) continue;
      await saveOfferInTransaction(db, owner, seller, {
        kind: row.kind,
        title: row.title,
        description: row.title,
        unitAmountMinor: row.unitAmountMinor,
        fulfillmentNote: "",
        requiresScopeReview: false,
        serviceScope: null,
        accessDays: row.kind === "digital" ? 30 : null,
        digitalAssetId: null,
        maxQuantity:
          row.kind === "goods" ? Math.min(10, Math.max(1, row.stock ?? 1)) : 1,
        stockTotal: row.kind === "goods" ? (row.stock ?? 0) : null,
      });
      created += 1;
    }
    return { created, skipped: rows.length - created };
  });
}
