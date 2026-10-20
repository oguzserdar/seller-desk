/**
 * Red-team contracts for the fictional people in a shop test. They act only inside an
 * isolated copy, only on the exact purchase the plan names, and a seller's scope
 * approval never counts as the buyer's payment approval. No model is involved.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeEach, expect, it } from "vitest";
import type { SimulationStep } from "@/lib/simulation";
import { ensureConversation, loadMessages } from "@/server/ai/conversation";
import { createDb, getDb } from "@/server/db/client";
import { installation, orders, paymentAttempt, sellerQuestion } from "@/server/db/schema";
import { readOwnerConversationControl } from "@/server/domain/conversation-control";
import { saveOffer, setOfferPublished } from "@/server/domain/offers";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { proposeQuote } from "@/server/domain/quotes";
import { getSeller } from "@/server/domain/seller";
import { askSeller } from "@/server/domain/seller-questions";
import { executeSimulationActor } from "@/server/simulation/actors";
import { installSimulationShop, type SimulationInstallation } from "@/server/simulation/install-snapshot";
import { simulationTranscript } from "@/server/simulation/observe";
import { withIsolatedSimulation } from "@/server/simulation/scope";
import { captureSimulationShop } from "@/server/simulation/snapshot";
import { newBuyer, offerId, resetShop, tally } from "../support/shop";
import { TEST_DATABASE_URL } from "../support/test-env";

let owner: OwnerPrincipal;
let repairId: string;
beforeEach(async () => {
  ({ owner } = await resetShop());
  const shop = await getSeller();
  if (!shop) throw new Error("No shop");
  const saved = await saveOffer(owner, shop, {
    kind: "service", title: "Repair after inspection", description: "Describe the damage for a written repair quote.",
    unitAmountMinor: null, fulfillmentNote: "Work starts after approval and payment.", requiresScopeReview: true,
    serviceScope: "Seller confirms repair scope and price before payment.", accessDays: null, digitalAssetId: null, maxQuantity: 5, stockTotal: null,
  });
  await setOfferPublished(owner, shop, { offerId: saved.id, expectedRevision: saved.revision, published: true });
  repairId = saved.id;
});

async function freshTarget() {
  const name = `actors_${Date.now()}_${process.pid}_simulation`;
  await getDb().execute(sql.raw(`create database "${name}"`));
  const url = new URL(TEST_DATABASE_URL); url.pathname = `/${name}`;
  const state = createDb(url.href, 1);
  try { await migrate(state.db, { migrationsFolder: "./drizzle" }); await state.db.insert(installation).values({ environment: "fixture" }); }
  finally { await state.pool.end(); }
  return url.href;
}

type Copy = { installed: SimulationInstallation; buyer: Awaited<ReturnType<typeof newBuyer>>; conversationId: string; approvals: ("buyer_checkout" | "seller_scope" | "fixture_payer")[] };

/** Installs the frozen shop in a fresh target, asks for two custom repairs, then runs the check inside the copy. */
async function inCopy(check: (copy: Copy, act: (step: SimulationStep) => Promise<void>) => Promise<void>) {
  const snapshot = await captureSimulationShop(owner);
  const before = await tally();
  await withIsolatedSimulation(owner, await freshTarget(), async () => {
    const installed = await installSimulationShop(snapshot);
    const buyer = await newBuyer();
    const conversationId = await ensureConversation(buyer);
    await proposeQuote(buyer, { lines: [{ offerId: installed.offerIds.get(repairId)!, quantity: 2 }], buyerNote: "Two damaged chair legs.", budgetMinor: 20000 });
    const copy: Copy = { installed, buyer, conversationId, approvals: [] };
    await check(copy, step => executeSimulationActor({ step, installed, buyer, conversationId, approvals: copy.approvals }));
  });
  // Nothing done inside the copy reaches the real shop.
  expect(await tally()).toEqual(before);
}

const repairLines = () => [{ sourceOfferId: repairId, quantity: 2 }];
const approve = (over: Partial<Extract<SimulationStep, { kind: "approve_scope" }>> = {}): SimulationStep => ({
  kind: "approve_scope", scope: "Repair both chair legs, keep the original finish.",
  expected: { lines: repairLines(), totalMinor: 17500, currency: "USD" }, prices: [{ sourceOfferId: repairId, unitAmountMinor: 8750 }], ...over,
});
const pay = (totalMinor: number): SimulationStep => ({ kind: "pay_quote", expected: { lines: repairLines(), totalMinor, currency: "USD" }, fault: "lost_capture_and_download" });

it("refuses to act outside an isolated simulation", async () => {
  const buyer = await newBuyer();
  await expect(executeSimulationActor({ step: approve(), installed: { owner, offerIds: new Map() }, buyer, conversationId: crypto.randomUUID(), approvals: [] }))
    .rejects.toThrow(/isolated simulation/);
});

it("binds offers, quantities and currency before any approval happens", async () => {
  const mug = await offerId("Disc brake pads");
  await inCopy(async (copy, act) => {
    const wrong: SimulationStep[] = [
      approve({ expected: { lines: [{ sourceOfferId: repairId, quantity: 1 }], totalMinor: 17500, currency: "USD" } }),
      approve({ expected: { lines: [{ sourceOfferId: mug, quantity: 2 }], totalMinor: 17500, currency: "USD" } }),
      approve({ expected: { lines: repairLines(), totalMinor: 17500, currency: "EUR" } }),
      approve({ prices: [{ sourceOfferId: crypto.randomUUID(), unitAmountMinor: 8750 }] }),
    ];
    for (const step of wrong) await expect(act(step)).rejects.toBeTruthy();
    expect(copy.approvals).toEqual([]);
    expect(await getDb().select().from(paymentAttempt)).toHaveLength(0);
  });
});

it("a seller's scope approval sets the price and never approves the payment", async () => {
  await inCopy(async (copy, act) => {
    await act(approve());
    expect(copy.approvals).toEqual(["seller_scope"]);
    expect(await getDb().select().from(paymentAttempt)).toHaveLength(0);
    expect(await getDb().select().from(orders)).toHaveLength(0);
  });
});

it("a seller-approved total that differs from the plan is recorded and stops before payment", async () => {
  await inCopy(async (copy, act) => {
    await expect(act(approve({ expected: { lines: repairLines(), totalMinor: 9999, currency: "USD" } }))).rejects.toMatchObject({ code: "conflict" });
    expect(copy.approvals).toEqual(["seller_scope"]);
    expect(await getDb().select().from(paymentAttempt)).toHaveLength(0);
  });
});

it("payment needs the exact approved amount, and a lost capture still ends in one order", async () => {
  await inCopy(async (copy, act) => {
    await act(approve());
    await expect(act(pay(17499))).rejects.toMatchObject({ code: "conflict" });
    expect(await getDb().select().from(paymentAttempt)).toHaveLength(0);
    await act(pay(17500));
    expect(copy.approvals).toEqual(["seller_scope", "buyer_checkout", "fixture_payer"]);
    expect(await getDb().select().from(orders)).toHaveLength(1);
    expect(await getDb().select().from(paymentAttempt)).toHaveLength(1);
  });
});

it("a seller reply is attributed to the seller, answers the open question and hands back", async () => {
  await inCopy(async (copy, act) => {
    await askSeller(copy.buyer, { question: "Can it be ready by Friday?", customerGoal: "Repair before the weekend", knownFacts: ["Two chair legs"] });
    await act({ kind: "seller_reply", text: "Yes, if you drop it off by Wednesday." });
    const [question] = await getDb().select().from(sellerQuestion);
    expect(question).toMatchObject({ state: "closed", answer: "Yes, if you drop it off by Wednesday." });
    expect((await readOwnerConversationControl(copy.installed.owner, copy.conversationId)).handler).toBe("assistant");
    const { transcript } = simulationTranscript(await loadMessages(copy.conversationId), copy.buyer.token);
    expect(transcript.at(-1)).toEqual({ role: "seller", text: "Yes, if you drop it off by Wednesday." });
    expect(transcript.some(line => line.role === "assistant")).toBe(false);
  });
});
