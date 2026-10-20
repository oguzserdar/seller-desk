import { getPayPal, setTransportForTests } from "@/server/paypal";
import { eq, sql } from "drizzle-orm";
import { getDb, transaction, createDb } from "@/server/db/client";
import { conversation, accessGrant } from "@/server/db/schema";
import { assertAssistantTurn } from "@/server/domain/assistant-turn";
import { guardTurnStream, guardTurnTools, watchTurn } from "@/server/ai/turn-runtime";
import { buyerTools } from "@/server/ai/buyer-tools";
import { getSeller } from "@/server/domain/seller";
import { retryAccess } from "@/server/domain/digital";
import { armFault } from "@/fixtures/paypal-fixture";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, tally } from "../support/shop";
import { withRequestDatabase } from "@/server/request-scope";
import { TEST_DATABASE_URL } from "../support/test-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { changeConversationHandler } from "@/server/domain/conversation-control";
import { proposeQuote } from "@/server/domain/quotes";
import { askSeller, latestQuestion } from "@/server/domain/seller-questions";
import { openQuote } from "@/server/ai/buyer-tools";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { newBuyer, offerId, resetShop } from "../support/shop";

let owner: OwnerPrincipal;
afterEach(() => setTransportForTests(null));
beforeEach(async () => { ({ owner } = await resetShop()); });

describe("takeover during an assistant tool", () => {
  it("refuses a quote and a question from a revoked turn, even after handback", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistantTurn = (await claimTurn(buyer, id))!;
    const assistant = { ...buyer, assistantTurn };
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    for (const revision of [2, 3]) {
      if (revision === 3) await changeConversationHandler(owner, { id, expectedRevision: 2, handler: "assistant" });
      await expect(proposeQuote(assistant, { lines: [{ offerId: await offerId("Disc brake pads"), quantity: 1 }] })).rejects.toThrow();
      await expect(askSeller(assistant, { question: "Can I collect Friday?", customerGoal: "Collect Friday", knownFacts: [] })).rejects.toThrow();
    }
    expect(await openQuote(buyer)).toBeUndefined(); expect(await latestQuestion(buyer)).toBeUndefined();
  });
  it("permits a live assistant and manual buyer, but rejects foreign and expired claims", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistantTurn = (await claimTurn(buyer, id))!; const assistant = { ...buyer, assistantTurn };
    const lines = [{ offerId: await offerId("Disc brake pads"), quantity: 1 }];
    expect((await proposeQuote(assistant, { lines })).status).toBe("review_ready");
    await expect(assertAssistantTurn({ ...(await newBuyer()), assistantTurn })).rejects.toThrow();
    await getDb().update(conversation).set({ activeTurnExpiresAt: sql`now() - interval '1 second'` }).where(eq(conversation.id, id));
    await expect(askSeller(assistant, { question: "Can I collect Friday?", customerGoal: "Collect Friday", knownFacts: [] })).rejects.toThrow();
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    expect((await proposeQuote(buyer, { lines })).status).toBe("review_ready");
  });

  it("checks ownership again inside the quote transaction after a concurrent takeover wins", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistantTurn = (await claimTurn(buyer, id))!; const lines = [{ offerId: await offerId("Disc brake pads"), quantity: 1 }];
    let pending!: Promise<unknown>;
    await transaction(getDb(), async tx => {
      await tx.select().from(conversation).where(eq(conversation.id, id)).for("update");
      pending = proposeQuote({ ...buyer, assistantTurn }, { lines }).catch(error => error);
      await tx.update(conversation).set({ handler: "seller", activeTurnId: null, activeTurnExpiresAt: null, controlRevision: 2 }).where(eq(conversation.id, id));
    });
    expect(await pending).toBeInstanceOf(Error); expect(await openQuote(buyer)).toBeUndefined();
  });

  it("cancels an idle provider, suppresses later stream chunks and rejects actual tool executions", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
    const watcher = watchTurn(assistant, new AbortController().signal);
    const stopped = vi.fn(); const stream = guardTurnStream<string>(assistant, stopped);
    const writer = stream.writable.getWriter(); const reader = stream.readable.getReader();
    const first = writer.write("transport probe"); expect((await reader.read()).value).toBe("transport probe"); await first;
    const tools = guardTurnTools(buyerTools(assistant, (await getSeller())!), assistant);
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    const end = reader.read(); await writer.write("must not reach the client"); await writer.close();
    await expect(end).resolves.toEqual({ done: true, value: undefined }); expect(stopped).toHaveBeenCalledOnce();
    await expect(tools.browse_catalog.execute!({ request: "mug", maxPriceMinor: null, kind: null }, { toolCallId: "revoked", messages: [], context: {} })).rejects.toThrow();
    await vi.waitFor(() => expect(watcher.signal.aborted).toBe(true), { timeout: 1500 }); watcher.dispose();
  });

  it("ends cleanly when ownership is revoked after provider cancellation has already started", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
    const watcher = watchTurn(assistant, new AbortController().signal);
    const stream = guardTurnStream<string>(assistant, watcher.abort);
    const writer = stream.writable.getWriter(); const reader = stream.readable.getReader();
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    watcher.abort();
    const end = reader.read();
    await writer.write("buffered provider output");
    await writer.write("provider abort event");
    await writer.close();
    await expect(end).resolves.toEqual({ done: true, value: undefined });
    watcher.dispose();
  });

  it("blocks assistant payment/download recovery while preserving independently authorized recovery", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    const assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
    const checkout = await checkoutFor(buyer, "Home brake care guide"); await approveAtPayPal(checkout);
    await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" });
    await expect(reconcilePayment(assistant, checkout.attemptId, { mayCapture: true })).rejects.toThrow();
    expect(await tally()).toMatchObject({ orders: 0, captures: 0 });
    await armFault(getDb(), "access_storage_error");
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    expect(paid.state).toBe("paid"); expect(paid.order).not.toBeNull();
    await expect(retryAccess(assistant, paid.order!.id)).rejects.toThrow();
    expect(await getDb().select().from(accessGrant)).toHaveLength(0);
    expect(await retryAccess(buyer, paid.order!.id)).toMatchObject({ outcome: "granted" });
    expect(await tally()).toMatchObject({ orders: 1, captures: 1 });
  });

  it("uses one connection for guarded mutations, including question corrections", async () => {
    const { db, pool } = createDb(TEST_DATABASE_URL, 1);
    try { await withRequestDatabase(db, async () => {
      const buyer = await newBuyer(); const id = await ensureConversation(buyer);
      const assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
      await proposeQuote(assistant, { lines: [{ offerId: await offerId("Disc brake pads"), quantity: 1 }] });
      await askSeller(assistant, { question: "Can I collect Friday?", customerGoal: "Collect Friday", knownFacts: [] });
      const result = await askSeller(assistant, { question: "Can I collect Saturday?", customerGoal: "Collect Saturday", knownFacts: [], replacePending: true });
      expect(result.updated).toBe(true);
    }); } finally { await pool.end(); }
  });

  it("rechecks after the PayPal read, but records a capture already dispatched before takeover", async () => {
    const buyer = await newBuyer(); const id = await ensureConversation(buyer);
    let assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
    const checkout = await checkoutFor(buyer, "Disc brake pads"); await approveAtPayPal(checkout);
    const resolved = getPayPal(); if (!resolved.ok) throw new Error("fixture unavailable");
    const transport = resolved.transport; let tookOver = false;
    setTransportForTests({ ...transport, getOrder: async (...args) => {
      const result = await transport.getOrder(...args);
      if (!tookOver) { await changeConversationHandler(owner, { id, expectedRevision: 1, handler: "seller" }); tookOver = true; }
      return result;
    } });
    await expect(reconcilePayment(assistant, checkout.attemptId, { mayCapture: true })).rejects.toThrow();
    expect(await tally()).toMatchObject({ captures: 0, orders: 0 });
    await changeConversationHandler(owner, { id, expectedRevision: 2, handler: "assistant" });
    assistant = { ...buyer, assistantTurn: (await claimTurn(buyer, id))! };
    setTransportForTests({ ...transport, captureOrder: async (...args) => {
      const result = await transport.captureOrder(...args);
      await changeConversationHandler(owner, { id, expectedRevision: 3, handler: "seller" });
      return result;
    } });
    expect((await reconcilePayment(assistant, checkout.attemptId, { mayCapture: true })).state).toBe("paid");
    expect(await tally()).toMatchObject({ captures: 1, orders: 1 });
  });

});
