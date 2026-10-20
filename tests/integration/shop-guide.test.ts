import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { GuideInput, GUIDE_LIMIT, publicShopUrl } from "@/lib/shop-guide";
import { getDb } from "@/server/db/client";
import { shopGuide } from "@/server/db/schema";
import { approvedDestination, listOwnerGuide, readShopGuide, removeGuide, saveGuide, showShopStep } from "@/server/domain/shop-guide";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { shopGuideTools } from "@/server/ai/shop-guide-tools";
import { GET } from "../../src/app/shop-step/[id]/route";
import { newBuyer, resetShop, tally } from "../support/shop";

const INPUT: GuideInput = { title: "Exchanges for wrong sizes", topic: "returns", body: "Unworn items may be exchanged within 14 days. Use the returns form. The seller must approve the request before an exchange is arranged.", published: false, actionLabel: "Request an exchange", actionUrl: "https://example.com/returns", productId: null, validUntil: null };
let owner: OwnerPrincipal;
const edit = (id: string, revision: number, extra: Partial<GuideInput> = {}) => ({ ...INPUT, id, expectedRevision: revision, ...extra });

describe("approved shop knowledge", () => {
  beforeEach(async () => { ({ owner } = await resetShop()); });

  it("keeps drafts out of the buyer's sources and exposes only approved public fields", async () => {
    const buyer = await newBuyer();
    const draft = await saveGuide(owner, INPUT);
    expect((await readShopGuide(buyer)).sources).toEqual([]);
    await expect(showShopStep(buyer, draft.id, 1)).rejects.toMatchObject({ code: "not_found" });
    const published = await saveGuide(owner, edit(draft.id, 1, { published: true }));
    const { sources } = await readShopGuide(buyer);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ title: INPUT.title, body: INPUT.body, revision: 2, hasNextStep: true });
    expect(sources[0]).not.toHaveProperty("sellerId");
    expect(sources[0]).not.toHaveProperty("actionUrl");
    expect((await showShopStep(buyer, published.id, 2)).host).toBe("example.com");
  });

  it("proves owner identity and shop scope on reads and mutations", async () => {
    const entry = await saveGuide(owner, INPUT);
    const wrongUser = { ...owner, userId: crypto.randomUUID() };
    const wrongShop = { ...owner, sellerId: crypto.randomUUID() };
    for (const caller of [wrongUser, wrongShop]) {
      await expect(listOwnerGuide(caller)).rejects.toMatchObject({ code: "not_found" });
      await expect(saveGuide(caller, edit(entry.id, 1, { published: true }))).rejects.toMatchObject({ code: "not_found" });
      await expect(removeGuide(caller, entry.id, 1)).rejects.toMatchObject({ code: "not_found" });
    }
    expect((await listOwnerGuide(owner))[0]?.revision).toBe(1);
  });

  it("rejects stale writes and requires the current publication revision on every click", async () => {
    const entry = await saveGuide(owner, { ...INPUT, published: true });
    const response = await GET(new Request(`http://localhost/shop-step/${entry.id}?revision=1&url=https://attacker.com`), { params: Promise.resolve({ id: entry.id }) });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(INPUT.actionUrl);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    await saveGuide(owner, edit(entry.id, 1, { published: true, actionUrl: "https://example.com/new-returns" }));
    await expect(saveGuide(owner, edit(entry.id, 1))).rejects.toMatchObject({ code: "conflict" });
    await expect(removeGuide(owner, entry.id, 1)).rejects.toMatchObject({ code: "conflict" });
    await expect(approvedDestination(owner.sellerId, entry.id, 1)).rejects.toMatchObject({ code: "not_found" });
    const expired = await GET(new Request(`http://localhost/shop-step/${entry.id}?revision=1`), { params: Promise.resolve({ id: entry.id }) });
    expect(expired.status).toBe(303);
    expect(expired.headers.get("Location")).toBe("/shop-step/unavailable");
    await saveGuide(owner, edit(entry.id, 2, { published: false }));
    await expect(approvedDestination(owner.sellerId, entry.id, 3)).rejects.toMatchObject({ code: "not_found" });
    await removeGuide(owner, entry.id, 3);
    expect(await listOwnerGuide(owner)).toEqual([]);
  });

  it("scopes buyer tools and leaves orders, quotes and payments untouched", async () => {
    const buyer = await newBuyer();
    const entry = await saveGuide(owner, { ...INPUT, published: true });
    const before = await tally();
    const tools = shopGuideTools(buyer);
    const options = { toolCallId: "test", messages: [], context: {} };
    const result = await tools.show_shop_step.execute!({ sourceId: entry.id, revision: 1 }, options);
    expect(result).toMatchObject({ step: { label: INPUT.actionLabel, host: "example.com" } });
    const foreign = { ...buyer, sellerId: crypto.randomUUID() };
    expect((await readShopGuide(foreign)).sources).toEqual([]);
    await expect(showShopStep(foreign, entry.id, 1)).rejects.toMatchObject({ code: "not_found" });
    expect(await tally()).toEqual(before);
    const quotes = await getDb().execute(sql`select count(*)::int as n from quote`);
    expect(quotes.rows[0]?.n).toBe(0);
  });

  it("read_shop_guide takes productId: null, as strict tool mode sends for 'whole shop' (real gpt-5-mini sent \"\" for an optional field)", async () => {
    const buyer = await newBuyer();
    await saveGuide(owner, { ...INPUT, published: true });
    const tools = shopGuideTools(buyer);
    const schema = tools.read_shop_guide.inputSchema as unknown as { safeParse: (value: unknown) => { success: boolean } };
    expect(schema.safeParse({ productId: null }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    const options = { toolCallId: "test", messages: [], context: {} };
    const result = await tools.read_shop_guide.execute!({ productId: null }, options);
    expect("sources" in result && result.sources.length).toBe(1);
  });

  it("requires a complete safe destination and bounded public text", () => {
    const hostile = ["javascript:alert(1)", "data:text/html,hello", "http://example.com", "https://user:pass@example.com", "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://localhost/", "https://shop.local/", "https://example.com:8443/", "https://example.com\\@evil.com", "https://example.com/\nnext"];
    for (const url of hostile) {
      expect(publicShopUrl(url), url).toBeNull();
      expect(GuideInput.safeParse({ ...INPUT, actionUrl: url }).success, url).toBe(false);
    }
    expect(publicShopUrl("https://shop.example.com/choose?size=M#stock")).toBe("https://shop.example.com/choose?size=M#stock");
    expect(GuideInput.safeParse({ ...INPUT, actionUrl: "" }).success).toBe(false);
    expect(GuideInput.safeParse({ ...INPUT, body: "a".repeat(2001) }).success).toBe(false);
    expect(GuideInput.safeParse({ ...INPUT, id: crypto.randomUUID() }).success).toBe(false);
  });

  it("cannot exceed the bounded guide when two owners' tabs publish concurrently", async () => {
    for (let i = 0; i < GUIDE_LIMIT - 1; i++) await saveGuide(owner, { ...INPUT, title: `Public note ${i}` });
    const results = await Promise.allSettled([saveGuide(owner, INPUT), saveGuide(owner, INPUT)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await listOwnerGuide(owner)).toHaveLength(GUIDE_LIMIT);
  });

  it("database constraints reject broken action pairs and invalid topics", async () => {
    const entry = await saveGuide(owner, INPUT);
    await expect(getDb().update(shopGuide).set({ actionLabel: null }).where(eq(shopGuide.id, entry.id))).rejects.toThrow();
    await expect(getDb().execute(sql`update shop_guide set topic = 'refund-executed' where id = ${entry.id}`)).rejects.toThrow();
  });
});
