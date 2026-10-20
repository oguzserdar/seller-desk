/** Storage tests use explicit records, never substitute a scripted reply for a live model. */
import { beforeEach, describe, expect, it } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { beginOwnerTurn, completeOwnerTurn, loadOwnerHistory, releaseOwnerTurn } from "@/server/ai/owner-conversation";
import { getDb } from "@/server/db/client";
import { ownerConversation, ownerMessage, ownerProposal } from "@/server/db/schema";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { decideProposal, proposeAction } from "@/server/domain/proposals";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, resetShop, tally } from "../support/shop";

let owner: OwnerPrincipal;
const input = (id = crypto.randomUUID()): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: "Storage test input" }] });
beforeEach(async () => { ({ owner } = await resetShop()); });

describe("durable owner conversation", () => {
  it("reads an empty history without creating a conversation", async () => {
    expect((await loadOwnerHistory(owner)).messages).toEqual([]);
    expect((await getDb().select({ n: count() }).from(ownerConversation))[0]?.n).toBe(0);
  });
  it("saves the input, retains it after failure, and reports an interrupted answer", async () => {
    const message = input(); const claim = await beginOwnerTurn(owner, message);
    expect((await loadOwnerHistory(owner)).busyUntil).not.toBeNull();
    await releaseOwnerTurn(claim);
    expect(await loadOwnerHistory(owner)).toMatchObject({ messages: [message], interrupted: true, busyUntil: null });
  });
  it("restores actual tool output and never reads another owner or seller's messages", async () => {
    const message = input(); const claim = await beginOwnerTurn(owner, message);
    const recorded: UIMessage = { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "tool-query_desk", toolCallId: "read", state: "output-available", input: { view: "all_orders", search: null }, output: { rows: [] } }] };
    await completeOwnerTurn(claim, [message, recorded]);
    expect((await loadOwnerHistory(owner)).messages).toEqual([message, recorded]);
    expect((await loadOwnerHistory({ ...owner, userId: crypto.randomUUID() })).messages).toEqual([]);
    expect((await loadOwnerHistory({ ...owner, sellerId: crypto.randomUUID() })).messages).toEqual([]);
    expect((await loadOwnerHistory(owner)).interrupted).toBe(false);
  });
  it("permits only one concurrent turn and rejects resubmission of the same input", async () => {
    const message = input(); const attempts = await Promise.allSettled([beginOwnerTurn(owner, message), beginOwnerTurn(owner, input())]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const won = attempts.find((a) => a.status === "fulfilled");
    if (won?.status !== "fulfilled") throw new Error("no claim");
    await releaseOwnerTurn(won.value);
    const saved = (await loadOwnerHistory(owner)).messages[0]!;
    await expect(beginOwnerTurn(owner, saved)).rejects.toThrow("already received");
    expect((await loadOwnerHistory(owner)).busyUntil).toBeNull();
  });
  it("an expired turn cannot commit or release its replacement", async () => {
    const old = await beginOwnerTurn(owner, input());
    await getDb().update(ownerConversation).set({ activeTurnExpiresAt: sql`now() - interval '1 second'` }).where(eq(ownerConversation.id, old.conversationId));
    const next = await beginOwnerTurn(owner, input());
    await expect(completeOwnerTurn(old, [])).rejects.toThrow("expired");
    await releaseOwnerTurn(old);
    expect((await loadOwnerHistory(owner)).busyUntil).not.toBeNull();
    await releaseOwnerTurn(next);
  });
  it("returns the latest 40 messages in order while preserving older records", async () => {
    for (let i = 0; i < 42; i++) { const claim = await beginOwnerTurn(owner, input(`input-${i}`)); await releaseOwnerTurn(claim); }
    const history = await loadOwnerHistory(owner);
    expect(history.messages).toHaveLength(40); expect(history.messages[0]?.id).toBe("input-2"); expect(history.messages[39]?.id).toBe("input-41");
    expect((await getDb().select({ n: count() }).from(ownerMessage))[0]?.n).toBe(42);
  });
  it("restores a declined proposal without running it, and reads expiry without mutation", async () => {
    const buyer = await newBuyer(); const payment = await checkoutFor(buyer, "Disc brake"); await approveAtPayPal(payment);
    const paid = await reconcilePayment(buyer, payment.attemptId, { mayCapture: true });
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: paid.order!.id });
    const claim = await beginOwnerTurn(owner, input());
    await completeOwnerTurn(claim, [{ id: "proposal-message", role: "assistant", parts: [{ type: "tool-propose_action", toolCallId: "p", state: "output-available", input: {}, output: proposal }] }]);
    const before = await tally();
    expect((await loadOwnerHistory(owner)).decisions).toEqual({});
    await decideProposal(owner, { proposalId: proposal.proposalId, approve: false });
    expect((await loadOwnerHistory(owner)).decisions[proposal.proposalId]?.state).toBe("rejected");
    expect(await tally()).toEqual(before);
    await getDb().update(ownerProposal).set({ state: "pending", expiresAt: new Date(0) }).where(and(eq(ownerProposal.id, proposal.proposalId), eq(ownerProposal.sellerId, owner.sellerId)));
    expect((await loadOwnerHistory(owner)).decisions[proposal.proposalId]?.state).toBe("expired");
    expect((await getDb().select().from(ownerProposal).where(eq(ownerProposal.id, proposal.proposalId)))[0]?.state).toBe("pending");
    await expect(decideProposal({ ...owner, sellerId: crypto.randomUUID() }, { proposalId: proposal.proposalId, approve: false })).rejects.toThrow("not found");
    expect((await getDb().select().from(ownerProposal).where(eq(ownerProposal.id, proposal.proposalId)))[0]?.state).toBe("pending");
  });
});
