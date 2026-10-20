/** Real-database simulation boundaries; no model mock or successful assistant reply is supplied. */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, beforeEach, it, expect } from "vitest";
import { seedShop } from "@/fixtures/seed";
import { createFixtureTransport } from "@/fixtures/paypal-fixture";
import { ensureConversation, loadMessages, saveMessages } from "@/server/ai/conversation";
import { createDb, getDb } from "@/server/db/client";
import { accessGrant, installation, seller } from "@/server/db/schema";
import { downloadWithGrant, grantToken } from "@/server/domain/digital";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { getServerConfig, resetServerConfigForTests } from "@/server/env";
import { getPayPal, setTransportForTests } from "@/server/paypal";
import { reconcilePayment } from "@/server/payments/engine";
import { withRequestDatabase } from "@/server/request-scope";
import { withIsolatedSimulation } from "@/server/simulation/scope";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";
import { TEST_DATABASE_URL } from "../support/test-env";

let owner: OwnerPrincipal;
const name = `scope_${Date.now()}_${process.pid}_simulation`;
const target = new URL(TEST_DATABASE_URL); target.pathname = `/${name}`;

beforeAll(async () => {
  await getDb().execute(sql.raw(`create database "${name}"`));
  const state = createDb(target.href, 1);
  try {
    await migrate(state.db, { migrationsFolder: "./drizzle" });
    await state.db.insert(installation).values({ environment: "fixture" });
    await withRequestDatabase(state.db, () => seedShop({ preset: "showcase", origins: [], fixturePassword: crypto.randomUUID() }));
  } finally { await state.pool.end(); }
});
beforeEach(async () => { ({ owner } = await resetShop()); });

it("refuses an unrelated owner before opening a target or running work", async () => {
  let called = false;
  await expect(withIsolatedSimulation({ ...owner, userId: crypto.randomUUID() }, "not-a-database", async () => { called = true; })).rejects.toMatchObject({ code: "not_found" });
  expect(called).toBe(false);
});

it("refuses the shop database and non-fixture installations", async () => {
  await expect(withIsolatedSimulation(owner, TEST_DATABASE_URL, async () => true)).rejects.toThrow(/dedicated database/);
  const state = createDb(target.href, 1);
  try {
    await withRequestDatabase(state.db, async () => {
      const [shop] = await getDb().select().from(seller);
      await expect(withIsolatedSimulation({ kind: "owner", sellerId: shop!.id, userId: shop!.ownerUserId }, target.href, async () => true)).rejects.toThrow(/differ/);
    });
    await state.db.update(installation).set({ environment: "sandbox" });
    await expect(withIsolatedSimulation(owner, target.href, async () => true)).rejects.toThrow(/fixture database/);
  } finally { await state.db.update(installation).set({ environment: "fixture" }); await state.pool.end(); }
});

it("isolates a full fictional payment while the original app keeps its sandbox settings", async () => {
  const before = await tally(), sourceDb = getDb();
  process.env.APP_MODE = "sandbox"; process.env.WOO_STORE_URL = "https://shop.example.com"; resetServerConfigForTests();
  const original = getServerConfig();
  setTransportForTests(createFixtureTransport(sourceDb, { appUrl: original.appUrl, secret: original.jobsSecret }));
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const continueWork = new Promise<void>(resolve => { finish = resolve; });
  const running = withIsolatedSimulation(owner, target.href, async () => {
    const config = getServerConfig();
    expect(config.mode).toBe("fixture"); expect(config.store).toBeNull();
    expect(config.authSecret).not.toBe(original.authSecret);
    expect(config.jobsSecret).not.toBe(original.jobsSecret);
    expect(getDb()).not.toBe(sourceDb);
    const payment = getPayPal(); expect(payment.ok && payment.transport.environment).toBe("fixture");
    enter(); await continueWork;
    const buyer = await newBuyer(); const checkout = await checkoutFor(buyer, "Home brake care guide");
    await approveAtPayPal(checkout);
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    expect(paid.state).toBe("paid"); expect(paid.environment).toBe("fixture");
    return tally();
  });
  try {
    await Promise.race([entered, running.then(() => { throw new Error("Simulation finished before isolation was checked"); })]);
    expect(getServerConfig()).toBe(original); expect(getDb()).toBe(sourceDb);
    expect(getServerConfig().mode).toBe("sandbox"); expect(getServerConfig().store?.host).toBe("shop.example.com");
    finish();
    expect(await running).toEqual({ orders: 1, captures: 1, providerOrders: 1, attempts: 1 });
    expect(await tally()).toEqual(before);
    expect(getServerConfig()).toBe(original);
    await withIsolatedSimulation(owner, target.href, async () => {
      const [grant] = await getDb().select().from(accessGrant);
      expect((await downloadWithGrant(grant!.id, grantToken(grant!.id))).mimeType).toBe("application/zip");
    });
  } finally { finish(); await running.catch(() => {}); setTransportForTests(null); process.env.APP_MODE = "fixture"; delete process.env.WOO_STORE_URL; resetServerConfigForTests(); }
});

it("restores request state after errors and preserves failed-run records", async () => {
  const original = getServerConfig(), source = getDb();
  const before = await withIsolatedSimulation(owner, target.href, tally);
  let conversationId = "";
  const message = { id: crypto.randomUUID(), role: "user" as const, parts: [{ type: "text" as const, text: "Please preserve this interrupted test request." }] };
  await expect(withIsolatedSimulation(owner, target.href, async () => {
    conversationId = await ensureConversation(await newBuyer());
    await saveMessages(conversationId, [message]);
    await expect(withIsolatedSimulation(owner, target.href, async () => true)).rejects.toThrow(/Nested/);
    throw new Error("Deliberate failed trial");
  })).rejects.toThrow("Deliberate failed trial");
  expect(getServerConfig()).toBe(original); expect(getDb()).toBe(source);
  expect(await withIsolatedSimulation(owner, target.href, tally)).toEqual(before);
  await withIsolatedSimulation(owner, target.href, async () => {
    expect(await loadMessages(conversationId)).toEqual([message]);
  });
});
