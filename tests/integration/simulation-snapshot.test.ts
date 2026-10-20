/** Real database checks for public-fact simulation copies, privacy and commerce isolation. */
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeEach, expect, it } from "vitest";
import { publishProcedure, saveProcedure } from "@/server/domain/assistant-procedures";
import { createDb, getDb } from "@/server/db/client";
import { account, assistantProcedure, digitalAsset, installation, inventory, offer, seller, shopGuide, user } from "@/server/db/schema";
import { downloadWithGrant, grantToken } from "@/server/domain/digital";
import { accessGrant } from "@/server/db/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { reconcilePayment } from "@/server/payments/engine";
import { captureSimulationShop } from "@/server/simulation/snapshot";
import { installSimulationShop } from "@/server/simulation/install-snapshot";
import { withIsolatedSimulation } from "@/server/simulation/scope";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";
import { TEST_DATABASE_URL } from "../support/test-env";

let owner: OwnerPrincipal;
beforeEach(async () => { ({ owner } = await resetShop()); });

it("refuses unrelated owners and refuses installation outside a simulation", async () => {
  await expect(captureSimulationShop({ ...owner, userId: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  const snapshot = await captureSimulationShop(owner);
  await expect(installSimulationShop(snapshot)).rejects.toThrow(/isolated simulation scope/);
});

it("freezes approved facts and available stock without credentials, private files or newer drafts", async () => {
  const db = getDb();
  const [goods] = await db.select().from(offer).where(eq(offer.kind, "goods"));
  await db.update(inventory).set({ total: 9, held: 2, sold: 3 }).where(eq(inventory.offerId, goods!.id));
  await db.update(seller).set({ contactEmail: "private-contact@example.test" });
  const [hidden] = await db.insert(offer).values({ sellerId: owner.sellerId, kind: "goods", title: "Private draft offer", description: "not approved", currency: "USD", unitAmountMinor: 200 }).returning();
  await db.insert(shopGuide).values([
    { sellerId: owner.sellerId, title: "Published fact", topic: "general", body: "Collect from the blue door.", published: true, productId: goods!.id, actionLabel: "Shop", actionUrl: "https://example.test/private-action" },
    { sellerId: owner.sellerId, title: "Private draft", topic: "general", body: "PRIVATE_GUIDE_CANARY", published: false },
    { sellerId: owner.sellerId, title: "Expired fact", topic: "general", body: "EXPIRED_GUIDE_CANARY", published: true, validUntil: new Date(0) },
    { sellerId: owner.sellerId, title: "Archived fact", topic: "general", body: "ARCHIVED_GUIDE_CANARY", archived: true },
    { sellerId: owner.sellerId, title: "Hidden product fact", topic: "general", body: "HIDDEN_PRODUCT_CANARY", published: true, productId: hidden!.id },
  ]);
  const id = crypto.randomUUID();
  const content = { title: "Repair questions", whenToUse: "When asked about a repair", steps: "Ask the seller before promising a repair deadline." };
  await saveProcedure(owner, { id, expectedRevision: 0, content });
  await publishProcedure(owner, { id, expectedRevision: 1, approve: true });
  await saveProcedure(owner, { id, expectedRevision: 1, content: { ...content, steps: "PRIVATE_INSTRUCTION_DRAFT_CANARY" } });
  const snapshot = await captureSimulationShop(owner);
  expect(snapshot.products.find(p => p.sourceId === goods!.id)?.available).toBe(4);
  expect(snapshot.guides.map(g => g.title)).toEqual(["Published fact"]);
  expect(snapshot.procedures).toEqual([{ sourceId: id, revision: 1, content }]);
  const serialized = JSON.stringify(snapshot);
  for (const secret of [owner.userId, owner.sellerId, "private-contact", "PRIVATE_", "EXPIRED_", "ARCHIVED_", "HIDDEN_", "private-action", "password", "digitalAssetId"]) expect(serialized).not.toContain(secret);
  await db.update(offer).set({ title: "Changed after capture" }).where(eq(offer.id, goods!.id));
  expect(snapshot.products.find(p => p.sourceId === goods!.id)?.title).toBe(goods!.title);
  expect(snapshot.limitations).toContain("Customer histories and private seller exceptions are not copied.");
});

it("rejects missing goods stock instead of inventing availability", async () => {
  await getDb().delete(inventory);
  await expect(captureSimulationShop(owner)).rejects.toMatchObject({ code: "invalid" });
});

it("installs a private copy once and pays for a fictional download without changing the source", async () => {
  const [sourceProduct] = await getDb().select().from(offer).where(eq(offer.kind, "goods"));
  await getDb().insert(shopGuide).values({ sellerId: owner.sellerId, title: "Product care", topic: "general",
    body: "Wash this product by hand.", productId: sourceProduct!.id, published: true });
  const procedureId = crypto.randomUUID();
  const content = { title: "Care questions", whenToUse: "When asked how to wash a product", steps: "Read the product-specific care instructions before answering." };
  await saveProcedure(owner, { id: procedureId, expectedRevision: 0, content });
  await publishProcedure(owner, { id: procedureId, expectedRevision: 1, approve: true });
  const snapshot = await captureSimulationShop(owner), before = await tally();
  const sourceAssets = await getDb().select().from(digitalAsset);
  const name = `snapshot_${Date.now()}_${process.pid}_simulation`;
  const target = new URL(TEST_DATABASE_URL); target.pathname = `/${name}`;
  await getDb().execute(sql.raw(`create database "${name}"`));
  const state = createDb(target.href, 1);
  try {
    await migrate(state.db, { migrationsFolder: "./drizzle" });
    await state.db.insert(installation).values({ environment: "fixture" });
  } finally { await state.pool.end(); }
  await withIsolatedSimulation(owner, target.href, async () => {
    const { owner: fictional } = await installSimulationShop(snapshot);
    expect(fictional.sellerId).not.toBe(owner.sellerId); expect(fictional.userId).not.toBe(owner.userId);
    expect(await getDb().select().from(account)).toEqual([]);
    const [testUser] = await getDb().select().from(user); expect(testUser?.email).toBe("simulation-owner@example.test");
    const copiedOffers = await getDb().select().from(offer);
    expect(copiedOffers).toHaveLength(snapshot.products.length);
    expect(copiedOffers.every(p => !snapshot.products.some(s => s.sourceId === p.id))).toBe(true);
    const [asset] = await getDb().select().from(digitalAsset);
    expect(asset?.bytes.toString()).toContain("SELLER DESK SIMULATION");
    expect(sourceAssets.every(original => original.sha256 !== asset?.sha256)).toBe(true);
    const buyer = await newBuyer(), checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    expect((await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true })).state).toBe("paid");
    const [grant] = await getDb().select().from(accessGrant);
    expect((await downloadWithGrant(grant!.id, grantToken(grant!.id))).bytes.toString()).toContain("SELLER DESK SIMULATION");
    const paid = await tally();
    await expect(installSimulationShop(snapshot)).rejects.toMatchObject({ code: "conflict" });
    expect(await tally()).toEqual(paid);
    expect(paid).toEqual({ orders: 1, attempts: 1, captures: 1, providerOrders: 1 });
    const [copiedGuide] = await getDb().select().from(shopGuide);
    expect(copiedGuide?.productId).toBe(copiedOffers.find(p => p.title === sourceProduct!.title)?.id);
    expect(copiedGuide?.productId).not.toBe(sourceProduct!.id);
    const [copiedProcedure] = await getDb().select().from(assistantProcedure);
    expect(copiedProcedure?.content).toEqual(content); expect(copiedProcedure?.id).not.toBe(procedureId);
  });
  expect(await tally()).toEqual(before);
  expect(await getDb().select().from(digitalAsset)).toEqual(sourceAssets);
});
