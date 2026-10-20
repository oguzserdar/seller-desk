import { randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { importDraft, inventory, offer } from "@/server/db/schema";
import { importOfferDrafts, ImportReviewInput, parseOfferList, previewOfferImport } from "@/server/domain/offer-import";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getSeller, type SellerRow } from "@/server/domain/seller";
import { resetShop } from "../support/shop";

describe("catalog file parsing", () => {
  it("reads one quoted multiline name as one record", () => {
    expect(parseOfferList('Name,Price,Stock\n"Cup, blue\nhandmade",22,4', "USD")).toEqual([
      expect.objectContaining({ title: "Cup, blue\nhandmade", unitAmountMinor: 2200, stock: 4, problem: null }),
    ]);
  });

  it("rejects an unclosed quote instead of silently changing the record", () => {
    expect(() => parseOfferList('"Cup,22,4', "USD")).toThrow();
  });

  it("does not turn signed, foreign-currency or oversized prices into valid prices", () => {
    for (const price of ["-10", "+10", "EUR 10", "£10", "from $10", "100001", "1,2"]) {
      expect(parseOfferList(`Cup,"${price}",4`, "USD")[0]?.problem, price).not.toBeNull();
    }
  });

  it("does not treat malformed stock as an unspecified item type", () => {
    for (const stock of ["-1", "1.5", "many"]) {
      expect(parseOfferList(`Cup,22,${stock}`, "USD")[0]?.problem, stock).not.toBeNull();
    }
  });

  it("reads BOM, tabs, reordered headers and escaped quotes", () => {
    const rows = parseOfferList('\uFEFFPrice\tStock\tName\tType\r\n22\t4\t"Cup, \"\"blue\"\""\tgoods', "CAD");
    expect(rows).toEqual([expect.objectContaining({ title: 'Cup, "blue"', unitAmountMinor: 2200, stock: 4, problem: null })]);
  });

  it("maps current Shopify columns without interpreting its category as fulfillment", () => {
    const rows = parseOfferList("URL handle,Title,Price,Inventory quantity,Type,Option1 value\ncup,Cup,22,4,service,Default Title", "USD");
    expect(rows[0]).toMatchObject({ title: "Cup", kind: "goods", unitAmountMinor: 2200, stock: 4, problem: null });
    const variants = parseOfferList("URL handle,Title,Price,Inventory quantity,Option1 value\ncup,Cup,22,4,Blue\ncup,,25,2,Red", "USD");
    expect(variants.every((row) => row.problem?.includes("variants"))).toBe(true);
  });

  it("maps simple WooCommerce products and rejects variations and sale pricing", () => {
    const rows = parseOfferList('ID,Type,Name,Regular price,Stock,Sale price\n1,simple,Cup,22,4,\n2,"simple, virtual, downloadable",Patterns,12,,\n3,variable,Shirt,25,4,\n4,simple,Sale cup,22,4,18', "USD");
    expect(rows[0]).toMatchObject({ title: "Cup", kind: "goods", unitAmountMinor: 2200, stock: 4, problem: null });
    expect(rows[1]).toMatchObject({ title: "Patterns", kind: "digital", stock: null, problem: null });
    expect(rows[2]?.problem).toContain("simple WooCommerce");
    expect(rows[3]?.problem).toContain("Sale pricing");
  });

  it("rejects oversized imports, ambiguous headings and malformed column counts", () => {
    expect(() => parseOfferList(Array.from({ length: 51 }, () => "Cup,22,4").join("\n"), "USD")).toThrow("50");
    expect(() => parseOfferList("x".repeat(20_001), "USD")).toThrow("20,000");
    expect(() => parseOfferList("Name,Price,Price\nCup,22,23", "USD")).toThrow("duplicate");
    expect(parseOfferList("Name,Price,Stock\nCup,22", "USD")[0]?.problem).toContain("column headings");
    expect(parseOfferList("Cup,22,4,goods,extra", "USD")[0]?.problem).toContain("columns");
  });
});

describe("reviewed catalog import", () => {
  let owner: OwnerPrincipal;
  let shop: SellerRow;
  beforeEach(async () => {
    ({ owner } = await resetShop());
    shop = (await getSeller())!;
  });

  it("uses only the stored review and commits once under concurrent requests", async () => {
    const preview = await previewOfferImport(owner, shop, "Import cup,22,4\nImport lamp,49,3\nInvalid,-1,3");
    const reference = { draftId: preview.draftId, reviewRevision: preview.reviewRevision };
    expect(ImportReviewInput.safeParse({ ...reference, text: "Changed,1,5" }).success).toBe(false);
    const results = await Promise.allSettled([importOfferDrafts(owner, shop, reference), importOfferDrafts(owner, shop, reference)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "fulfilled")).toMatchObject({ value: { created: 2, skipped: 1 } });
    const saved = await getDb().select().from(offer).where(like(offer.title, "Import %"));
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => !row.published)).toBe(true);
    const [stock] = await getDb().select().from(inventory).where(eq(inventory.offerId, saved.find((row) => row.title === "Import cup")!.id));
    expect(stock?.total).toBe(4);
  });

  it("rejects another seller, stale review and changed currency without consuming the review", async () => {
    const preview = await previewOfferImport(owner, shop, "Import cup,22,4");
    const reference = { draftId: preview.draftId, reviewRevision: preview.reviewRevision };
    const other = { ...owner, sellerId: randomUUID() };
    await expect(importOfferDrafts(other, { ...shop, id: other.sellerId }, reference)).rejects.toMatchObject({ code: "conflict" });
    await expect(importOfferDrafts(owner, shop, { ...reference, reviewRevision: 99 })).rejects.toMatchObject({ code: "conflict" });
    await expect(importOfferDrafts(owner, { ...shop, currency: "CAD" }, reference)).rejects.toMatchObject({ code: "conflict" });
    const [stored] = await getDb().select().from(importDraft).where(eq(importDraft.id, reference.draftId));
    expect(stored).toMatchObject({ status: "draft", reviewRevision: 1 });
    await expect(importOfferDrafts(owner, shop, reference)).resolves.toEqual({ created: 1, skipped: 0 });
  });

  it("rolls back every offer and the claim when a later write fails", async () => {
    const preview = await previewOfferImport(owner, shop, "Import first,22,4\nImport fail,49,3");
    const reference = { draftId: preview.draftId, reviewRevision: preview.reviewRevision };
    const db = getDb();
    await db.execute(sql`create function reject_import_test() returns trigger language plpgsql as $$ begin if NEW.title = 'Import fail' then raise exception 'test interruption'; end if; return NEW; end $$`);
    await db.execute(sql`create trigger reject_import_test before insert on offer for each row execute function reject_import_test()`);
    try {
      await expect(importOfferDrafts(owner, shop, reference)).rejects.toThrow();
      expect(await db.select().from(offer).where(like(offer.title, "Import %"))).toHaveLength(0);
      const [stored] = await db.select().from(importDraft).where(eq(importDraft.id, reference.draftId));
      expect(stored).toMatchObject({ status: "draft", reviewRevision: 1 });
    } finally {
      await db.execute(sql`drop trigger reject_import_test on offer`);
      await db.execute(sql`drop function reject_import_test()`);
    }
    await expect(importOfferDrafts(owner, shop, reference)).resolves.toEqual({ created: 2, skipped: 0 });
  });
});
