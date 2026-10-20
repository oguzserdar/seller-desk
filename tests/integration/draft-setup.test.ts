/**
 * Assisted setup keeps only what the owner actually wrote: every kept value is
 * found in their text (spacing and case may differ), an invented price stays
 * empty, and added drafts are unpublished and added once.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDraftedOffers, buildDrafts, type ExtractionResult, locate } from "@/server/ai/draft-setup";
import { getDb } from "@/server/db/client";
import { importDraft, offer } from "@/server/db/schema";
import type { DomainError } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getSeller } from "@/server/domain/seller";
import { resetShop } from "../support/shop";

const SOURCE = "Desk lamp: $49, plug-in, 3 in stock.\nRechargeable lamp, cordless.\nLamp repair: I check it first, then fix the wiring. $30.";

const EXTRACTION: ExtractionResult = {
  offers: [
    { title: "Desk lamp", kind: "goods", titleQuote: "desk  LAMP", priceQuote: "$49", stockQuote: "3 in stock", descriptionQuote: "Desk lamp: $49, plug-in, 3 in stock.", scopeQuote: null },
    { title: "Rechargeable lamp", kind: "goods", titleQuote: "Rechargeable lamp", priceQuote: "$69", stockQuote: null, descriptionQuote: null, scopeQuote: null },
    { title: "Lamp repair", kind: "service", titleQuote: "Lamp repair", priceQuote: "$30", stockQuote: null, descriptionQuote: null, scopeQuote: "I check it first, then fix the wiring." },
  ],
  missing: ["When can customers pick up?"],
};

let owner: OwnerPrincipal;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as DomainError).code ?? "error";
  }
}

beforeEach(async () => {
  ({ owner } = await resetShop());
});

describe("assisted setup", () => {
  it("finds quotes in the owner's text, allowing only spacing and letter case to differ", () => {
    expect(locate(SOURCE, "$49")).toMatchObject({ quote: "$49", start: SOURCE.indexOf("$49") });
    expect(locate(SOURCE, "desk  LAMP")).toMatchObject({ quote: "Desk lamp", start: 0, end: 9 });
    expect(locate(SOURCE, "$69")).toBeNull();
    expect(locate(SOURCE, "solar lamp")).toBeNull();
  });

  it("keeps only values found in the text; an invented price stays empty and the draft is not pre-selected", () => {
    const [desk, rechargeable, repair] = buildDrafts(SOURCE, EXTRACTION, "USD");
    expect(desk).toMatchObject({ include: true, priceMinor: { value: 4900, status: "grounded" }, stock: { value: 3, status: "grounded" } });
    expect(desk?.title.evidence).toMatchObject({ start: 0, end: 9 });
    expect(rechargeable).toMatchObject({ include: false, priceMinor: { value: null, status: "unknown" } });
    expect(repair).toMatchObject({ include: true, kind: { value: "service" }, serviceScope: { value: "I check it first, then fix the wiring.", status: "grounded" } });
  });

  it("does not turn negative, ranged, discounted, foreign-currency or malformed amounts into a fixed USD price", () => {
    for (const quote of ["-$10", "£10", "EUR 10", "$10-$20", "from $10", "$10 for 2", "10%", "1,2", "$1000000"]) {
      const source = `Notebook ${quote}`;
      const extraction = { offers: [{ ...EXTRACTION.offers[0]!, titleQuote: "Notebook", priceQuote: quote }], missing: [] };
      expect(buildDrafts(source, extraction, "USD")[0]?.priceMinor.status, quote).toBe("unknown");
    }
  });

  it("adds the chosen drafts as unpublished offers, once", async () => {
    const shop = await getSeller();
    if (!shop) throw new Error("no shop");
    const drafts = buildDrafts(SOURCE, EXTRACTION, "USD");
    const [row] = await getDb()
      .insert(importDraft)
      .values({ sellerId: shop.id, sourceKind: "paste", sourceText: SOURCE, sourceHash: "test", proposed: drafts, generator: "test:none" })
      .returning();
    if (!row) throw new Error("no draft row");
    const choices = drafts.map((draft) => ({ key: draft.key, include: true, kind: draft.kind.value ?? ("goods" as const) }));
    const result = await addDraftedOffers(owner, shop, { draftId: row.id, reviewRevision: row.reviewRevision, choices });
    expect(result).toEqual({ created: 2, skipped: 1 });
    const added = await getDb().select().from(offer).where(eq(offer.title, "Lamp repair"));
    expect(added).toHaveLength(1);
    expect(added[0]?.published).toBe(false);
    expect(await code(addDraftedOffers(owner, shop, { draftId: row.id, reviewRevision: row.reviewRevision, choices }))).toBe("conflict");
  });
});
