import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { buyerTools } from "@/server/ai/buyer-tools";
import { getDb } from "@/server/db/client";
import { offer, shopGuide } from "@/server/db/schema";
import { readCatalogGuide, saveGuide } from "@/server/domain/shop-guide";
import { getSeller } from "@/server/domain/seller";
import type { GuideInput } from "@/lib/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, offerId, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const base: GuideInput = { title: "Disc brake pads care", body: "The Disc brake pads must be hand washed. It is not dishwasher-safe.", topic: "general", published: true, productId: null, validUntil: null, actionLabel: "", actionUrl: "" };
describe("catalog reads include current matching rules", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  it("returns conflicting product evidence with the first catalog read, without relying on a second AI lookup", async () => {
    const mug = await offerId("Disc brake pads");
    const rule = await saveGuide(owner, { ...base, productId: mug });
    const buyer = await newBuyer(); const before = await tally();
    const shop = (await getSeller())!;
    const tools = buyerTools(buyer, shop);
    const read = () => tools.browse_catalog.execute!({ request: "two dishwasher-safe coffee gifts", maxPriceMinor: 4000, kind: "goods" }, { toolCallId: "scope-regression", messages: [], context: {} });
    expect(await read()).toMatchObject({ taxPolicy: shop.taxPolicy, sources: [expect.objectContaining({ id: rule.id, productId: mug, body: base.body, revision: 1 })] });
    await saveGuide(owner, { ...base, id: rule.id, expectedRevision: 1, productId: mug, body: "Use only cool water when washing this mug by hand." });
    expect(await read()).toMatchObject({ sources: [expect.objectContaining({ revision: 2, body: "Use only cool water when washing this mug by hand." })] });
    expect(await tally()).toEqual(before);
  });
  it("excludes unrelated, draft, archived and expired facts from catalog evidence", async () => {
    const mug = await offerId("Disc brake pads"); const digital = await offerId("Home brake care guide");
    await saveGuide(owner, { ...base, productId: digital });
    await saveGuide(owner, { ...base, productId: mug, published: false });
    const expired = await saveGuide(owner, { ...base, productId: mug });
    await getDb().update(shopGuide).set({ validUntil: sql`now() - interval '1 second'` }).where(eq(shopGuide.id, expired.id));
    const archived = await saveGuide(owner, { ...base, productId: mug });
    await getDb().update(shopGuide).set({ archived: true, published: false }).where(eq(shopGuide.id, archived.id));
    const general = await saveGuide(owner, { ...base, title: "Shop care", body: "Ask the shop before using cleaning chemicals." });
    const tools = buyerTools(await newBuyer(), (await getSeller())!);
    const result = await tools.browse_catalog.execute!({ request: "coffee gifts", maxPriceMinor: 4000, kind: "goods" }, { toolCallId: "scope-filter", messages: [], context: {} });
    expect(result).toMatchObject({ sources: [expect.objectContaining({ id: general.id, productId: null })] });
  });
  it("rechecks product publication and seller scope even for supplied product ids", async () => {
    const mug = await offerId("Disc brake pads"); const buyer = await newBuyer();
    await saveGuide(owner, { ...base, productId: mug });
    expect((await readCatalogGuide(buyer, [mug])).sources).toHaveLength(1);
    expect((await readCatalogGuide({ ...buyer, sellerId: crypto.randomUUID() }, [mug])).sources).toEqual([]);
    await getDb().update(offer).set({ published: false }).where(eq(offer.id, mug));
    expect((await readCatalogGuide(buyer, [mug])).sources).toEqual([]);
  });
});
