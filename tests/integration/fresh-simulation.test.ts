/** New seller-facing allocation path. Actual commerce and failure-only AI; no scripted successful response. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createD1Db } from "@/server/storage/d1/client";
import { withD1Database } from "@/server/request-scope";
import { withFreshSimulation } from "@/server/simulation/trial-database";
import { captureSimulationShop } from "@/server/simulation/snapshot";
import { installSimulationShop } from "@/server/simulation/install-snapshot";
import { executeSimulationActor } from "@/server/simulation/actors";
import { executeSimulation } from "@/server/simulation/execute";
import { listSimulations } from "@/server/simulation/runs";
import { ensureConversation } from "@/server/ai/conversation";
import { proposeQuote } from "@/server/domain/quotes";
import { resolveBuyer, startBuyerSession } from "@/server/domain/buyer-session";
import { readSimulationRecords } from "@/server/simulation/records";
import { PROVIDER_FACTORIES } from "@/server/ai/registry";
import { resetServerConfigForTests } from "@/server/env";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";
import type { SimulationStep } from "@/lib/simulation";
import { newTrialDurableObject } from "../support/trial-durable-object";

for (const variant of ["postgres-node", "d1-node", "d1-worker"] as const) describe(`${variant}: fresh seller trials`, () => {
  const dialect = variant === "postgres-node" ? "postgres" : "d1";
  let fixture: StorageFixture;
  let runtime: Awaited<ReturnType<typeof newTrialDurableObject>> | undefined;
  beforeEach(async () => { fixture = await newStorageFixture(dialect); if (variant === "d1-worker") runtime = await newTrialDurableObject(); });
  afterEach(async () => {
    vi.restoreAllMocks(); delete process.env.AI_PROVIDER; delete process.env.AI_MODEL_ID; delete process.env.OPENAI_API_KEY; resetServerConfigForTests();
    await fixture?.close(); await runtime?.close();
  });
  const run = <T>(operation: () => Promise<T>) => fixture.binding ? withD1Database(createD1Db(fixture.binding), operation, runtime?.factory) : operation();
  const plan = () => ({ requestId: crypto.randomUUID(), scenario: "Isabel needs help choosing an item without paying yet.", expectedOutcome: "Ask what she needs; do not charge her.", change: { kind: "none" as const } });
  it("refuses an unrelated owner before allocating trial storage", async () => {
    await expect(run(() => withFreshSimulation({ ...fixture.owner, userId: crypto.randomUUID() }, async () => { throw new Error("must not run"); }))).rejects.toMatchObject({ code: "not_found" });
  });
  it("completes actual goods, services and digital actor purchases in separate shops without changing original commerce", async () => {
    const snapshot = await run(() => captureSimulationShop(fixture.owner));
    const before = JSON.stringify(await fixture.query("SELECT id FROM orders"));
    for (const [id, amount] of [[fixture.goodsId, 3500], [fixture.serviceId, 4000], [fixture.digitalId, 2500]] as const) {
      await run(() => withFreshSimulation(fixture.owner, async () => {
        const installed = await installSimulationShop(snapshot);
        const issued = await startBuyerSession("page"), buyer = await resolveBuyer(issued.token), conversationId = await ensureConversation(buyer);
        await proposeQuote(buyer, { lines: [{ offerId: installed.offerIds.get(id)!, quantity: 1 }] });
        const approvals: ("buyer_checkout" | "seller_scope" | "fixture_payer")[] = [];
        const expected = { lines: [{ sourceOfferId: id, quantity: 1 }], totalMinor: amount, currency: "USD" };
        const act = (step: SimulationStep) => executeSimulationActor({ installed, buyer, conversationId, approvals, step });
        await expect(act({ kind: "pay_quote", expected: { ...expected, totalMinor: amount + 1 }, fault: "none" })).rejects.toMatchObject({ code: "conflict" });
        expect((await readSimulationRecords()).captures).toBe(0);
        await act({ kind: "pay_quote", expected, fault: "lost_capture_and_download" });
        const records = await readSimulationRecords();
        expect(records).toMatchObject({ paidOrders: 1, captures: 1 });
        expect(approvals).toEqual(["buyer_checkout", "fixture_payer"]);
      }));
    }
    expect(JSON.stringify(await fixture.query("SELECT id FROM orders"))).toBe(before);
    expect(Number((await fixture.query("SELECT sold FROM inventory WHERE offer_id=?", [fixture.goodsId]))[0]!.sold)).toBe(0);
  });
  it("fails closed without a model and never creates an artificial successful report", async () => {
    await expect(run(() => executeSimulation(fixture.owner, plan()))).rejects.toMatchObject({ code: "unavailable" });
    expect(await run(() => listSimulations(fixture.owner))).toEqual([]);
  });
  it("requires explicit seller scope and price before a custom service can be paid", async () => {
    await fixture.query("UPDATE offer SET unit_amount_minor=NULL, requires_scope_review=? WHERE id=?", [true, fixture.serviceId]);
    const snapshot = await run(() => captureSimulationShop(fixture.owner));
    await run(() => withFreshSimulation(fixture.owner, async () => {
      const installed = await installSimulationShop(snapshot);
      const issued = await startBuyerSession("page"), buyer = await resolveBuyer(issued.token), conversationId = await ensureConversation(buyer);
      await proposeQuote(buyer, { lines: [{ offerId: installed.offerIds.get(fixture.serviceId)!, quantity: 2 }], buyerNote: "Two brake cables are frayed and need replacement. Confirm the work before payment.", budgetMinor: 20000 });
      const approvals: ("buyer_checkout" | "seller_scope" | "fixture_payer")[] = [];
      const expected = { lines: [{ sourceOfferId: fixture.serviceId, quantity: 2 }], totalMinor: 17500, currency: "USD" };
      const act = (step: SimulationStep) => executeSimulationActor({ installed, buyer, conversationId, approvals, step });
      await expect(act({ kind: "pay_quote", expected, fault: "none" })).rejects.toMatchObject({ code: "conflict" });
      await act({ kind: "approve_scope", expected, scope: "Repair the front brake cables only. Seller confirms timing separately.", prices: [{ sourceOfferId: fixture.serviceId, unitAmountMinor: 8750 }] });
      expect(await readSimulationRecords()).toMatchObject({ captures: 0, paidOrders: 0 });
      expect(approvals).toEqual(["seller_scope"]);
      await act({ kind: "pay_quote", expected, fault: "none" });
      expect(await readSimulationRecords()).toMatchObject({ captures: 1, paidOrders: 1 });
    }));
    expect(await fixture.query("SELECT id FROM orders")).toEqual([]);
  });
  it("saves actual provider failure, reuses the same request after reload and permits a new independent trial", async () => {
    process.env.AI_PROVIDER = "openai"; process.env.AI_MODEL_ID = "failure-contract"; process.env.OPENAI_API_KEY = "test-only-not-a-credential"; resetServerConfigForTests();
    const model = new MockLanguageModelV4({ doStream: async () => { throw new Error("Failure-only contract. No successful AI text."); } });
    vi.spyOn(PROVIDER_FACTORIES, "openai").mockReturnValue(model);
    const input = plan();
    const first = await run(() => executeSimulation(fixture.owner, input));
    expect(first.state).toBe("failed");
    expect(first.current?.transcript).toEqual([{ role: "user", text: input.scenario }]);
    expect(first.current?.records).toMatchObject({ captures: 0, paidOrders: 0 });
    expect(await run(() => executeSimulation(fixture.owner, input))).toEqual(first);
    expect(model.doStreamCalls).toHaveLength(1);
    const second = await run(() => executeSimulation(fixture.owner, plan()));
    expect(second.id).not.toBe(first.id); expect(second.current?.transcript).toEqual(first.current?.transcript);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(await run(() => listSimulations(fixture.owner))).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls.map(call => call.prompt))).not.toContain(input.expectedOutcome);
  });
});
