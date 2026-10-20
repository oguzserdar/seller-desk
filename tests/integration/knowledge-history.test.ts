/** Real PostgreSQL checks for scope, expiry and recoverable knowledge versions. */
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { GuideInput } from "@/lib/shop-guide";
import { getDb } from "@/server/db/client";
import { offer, shopGuide } from "@/server/db/schema";
import { approvedDestination, guideHistory, listOwnerGuide, readShopGuide, removeGuide, restoreGuideVersion, saveGuide } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, offerId, resetShop } from "../support/shop";

const input: GuideInput = { title: "Care for this product", body: "Wash this item by hand with warm water.", topic: "general", published: true, productId: null, validUntil: null, actionLabel: "Care instructions", actionUrl: "https://example.com/care" };
let owner: OwnerPrincipal;
describe("scoped knowledge and durable versions", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });
  it("returns product rules only for their published product and shop facts for everyone", async () => {
    const buyer = await newBuyer();
    const mug = await offerId("Disc brake pads"); const other = await offerId("Home brake care guide");
    const general = await saveGuide(owner, input);
    const specific = await saveGuide(owner, { ...input, productId: mug, title: "Disc brake pads care" });
    expect((await readShopGuide(buyer)).sources.map(x => x.id)).toEqual([general.id]);
    expect((await readShopGuide(buyer, other)).sources.map(x => x.id)).toEqual([general.id]);
    expect((await readShopGuide(buyer, mug)).sources).toEqual(expect.arrayContaining([expect.objectContaining({ id: specific.id, productId: mug })]));
    await getDb().update(offer).set({ published: false }).where(eq(offer.id, mug));
    await expect(readShopGuide(buyer, mug)).rejects.toMatchObject({ code: "not_found" });
    await expect(approvedDestination(owner.sellerId, specific.id, specific.revision)).rejects.toMatchObject({ code: "not_found" });
    await expect(saveGuide(owner, { ...input, productId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    await expect(readShopGuide(buyer, crypto.randomUUID())).rejects.toMatchObject({ code: "not_found" });
  });
  it("stops both model reads and old action links after expiry without needing a cleanup job", async () => {
    const buyer = await newBuyer();
    const rule = await saveGuide(owner, { ...input, validUntil: new Date(Date.now() + 60_000).toISOString() });
    expect((await readShopGuide(buyer)).sources).toHaveLength(1);
    expect((await approvedDestination(owner.sellerId, rule.id, rule.revision)).id).toBe(rule.id);
    await getDb().update(shopGuide).set({ validUntil: sql`now() - interval '1 second'` }).where(eq(shopGuide.id, rule.id));
    expect((await readShopGuide(buyer)).sources).toEqual([]);
    await expect(approvedDestination(owner.sellerId, rule.id, rule.revision)).rejects.toMatchObject({ code: "not_found" });
    await expect(saveGuide(owner, { ...input, validUntil: new Date(Date.now() - 60_000).toISOString() })).rejects.toMatchObject({ code: "invalid" });
  });
  it("retains edit and removal history, restores as a new draft, and rejects stale restoration", async () => {
    const buyer = await newBuyer();
    const rule = await saveGuide(owner, input);
    const changed = await saveGuide(owner, { ...input, id: rule.id, expectedRevision: 1, body: "Use cold water for this item instead." });
    await removeGuide(owner, rule.id, changed.revision);
    expect(await listOwnerGuide(owner)).toEqual([]);
    expect(await listOwnerGuide(owner, true)).toHaveLength(1);
    expect((await guideHistory(owner, rule.id)).map(v => v.revision)).toEqual([3, 2, 1]);
    const restored = await restoreGuideVersion(owner, rule.id, 3, 1);
    expect(restored).toMatchObject({ revision: 4, body: input.body, published: false, archived: false });
    expect((await readShopGuide(buyer)).sources).toEqual([]);
    expect((await guideHistory(owner, rule.id)).map(v => v.revision)).toEqual([4, 3, 2, 1]);
    await expect(restoreGuideVersion(owner, rule.id, 3, 2)).rejects.toMatchObject({ code: "conflict" });
    await expect(approvedDestination(owner.sellerId, rule.id, 1)).rejects.toMatchObject({ code: "not_found" });
    await saveGuide(owner, { ...input, id: rule.id, expectedRevision: 4 });
    expect((await readShopGuide(buyer)).sources[0]?.revision).toBe(5);
  });
  it("keeps immutable snapshots when two owner tabs race and scopes history to the owner", async () => {
    const rule = await saveGuide(owner, input);
    const results = await Promise.allSettled([saveGuide(owner, { ...input, id: rule.id, expectedRevision: 1, body: "First change needs owner review." }), saveGuide(owner, { ...input, id: rule.id, expectedRevision: 1, body: "Second change needs owner review." })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const history = await guideHistory(owner, rule.id);
    expect(history).toHaveLength(2); expect(history[1]?.snapshot.body).toBe(input.body);
    for (const caller of [{ ...owner, userId: crypto.randomUUID() }, { ...owner, sellerId: crypto.randomUUID() }]) {
      await expect(guideHistory(caller, rule.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(restoreGuideVersion(caller, rule.id, 2, 1)).rejects.toMatchObject({ code: "not_found" });
    }
  });
});
