/**
 * The assistants act only through server rules: owner suggestions run once,
 * only on approval, only while the order is unchanged and only for the shop
 * that owns it; buyer tools let the model choose offers but never prices; the
 * list import creates unpublished drafts only.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { armFault } from "@/fixtures/paypal-fixture";
import { buyerTools } from "@/server/ai/buyer-tools";
import { getDb } from "@/server/db/client";
import { accessGrant, fulfillmentTask, offer, ownerProposal } from "@/server/db/schema";
import type { DomainError } from "@/server/domain/errors";
import { importOfferDrafts, parseOfferList, previewOfferImport } from "@/server/domain/offer-import";
import { completePickup } from "@/server/domain/orders";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { decideProposal, proposeAction } from "@/server/domain/proposals";
import { getSeller } from "@/server/domain/seller";
import { reconcilePayment } from "@/server/payments/engine";
import { approveAtPayPal, checkoutFor, newBuyer, offerId, resetShop } from "../support/shop";

let owner: OwnerPrincipal;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return (error as DomainError).code ?? "error";
  }
}

async function buy(buyer: BuyerPrincipal, title: string): Promise<string> {
  const view = await checkoutFor(buyer, title);
  await approveAtPayPal(view);
  const paid = await reconcilePayment(buyer, view.attemptId, { mayCapture: true });
  if (paid.state !== "paid" || !paid.order) throw new Error(`not paid: ${paid.state}`);
  return paid.order.id;
}

async function pickupTask(orderId: string) {
  const [row] = await getDb()
    .select()
    .from(fulfillmentTask)
    .where(and(eq(fulfillmentTask.orderId, orderId), eq(fulfillmentTask.type, "pickup")));
  if (!row) throw new Error("no pickup task");
  return row;
}

const toolOptions = { toolCallId: "test-call", messages: [], context: {} };

beforeEach(async () => {
  ({ owner } = await resetShop());
});

describe("owner suggestions", () => {
  it("run only after approval, and only once", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    expect((await pickupTask(orderId)).state).not.toBe("completed");

    expect(await decideProposal(owner, { proposalId: proposal.proposalId, approve: true })).toMatchObject({ state: "executed" });
    expect(await code(decideProposal(owner, { proposalId: proposal.proposalId, approve: true }))).toBe("conflict");
    const task = await pickupTask(orderId);
    expect(task.state).toBe("completed");
    expect(task.revision).toBe(2);
  });

  it("two approvals at the same moment execute once", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    const outcomes = await Promise.all([0, 1].map(() => code(decideProposal(owner, { proposalId: proposal.proposalId, approve: true }))));
    expect(outcomes.sort()).toEqual(["conflict", "resolved"]);
    expect((await pickupTask(orderId)).revision).toBe(2);
  });

  it("fail without touching the order when it changed after the suggestion", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    const before = await pickupTask(orderId);
    await completePickup(owner, { taskId: before.id, expectedRevision: before.revision, note: "Collected at the counter" });
    const decision = await decideProposal(owner, { proposalId: proposal.proposalId, approve: true });
    expect(decision.state).toBe("failed");
    expect((await pickupTask(orderId)).revision).toBe(before.revision + 1);
  });

  it("cannot be approved after they expire", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    await getDb().update(ownerProposal).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(ownerProposal.id, proposal.proposalId));
    expect(await code(decideProposal(owner, { proposalId: proposal.proposalId, approve: true }))).toBe("conflict");
    expect((await pickupTask(orderId)).state).not.toBe("completed");
  });

  it("change nothing when declined", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    expect(await decideProposal(owner, { proposalId: proposal.proposalId, approve: false })).toMatchObject({ state: "rejected" });
    expect((await pickupTask(orderId)).state).not.toBe("completed");
  });

  it("are invisible to another shop's owner", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const stranger: OwnerPrincipal = { kind: "owner", userId: owner.userId, sellerId: crypto.randomUUID() };
    expect(await code(proposeAction(stranger, { action: "mark_picked_up", targetId: orderId }))).toBe("not_found");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    expect(await code(decideProposal(stranger, { proposalId: proposal.proposalId, approve: true }))).toBe("not_found");
  });

  it("refuse work that is already done", async () => {
    const orderId = await buy(await newBuyer(), "Disc brake pads");
    const proposal = await proposeAction(owner, { action: "mark_picked_up", targetId: orderId });
    await decideProposal(owner, { proposalId: proposal.proposalId, approve: true });
    expect(await code(proposeAction(owner, { action: "mark_picked_up", targetId: orderId }))).toBe("invalid");
  });

  it("retry a failed download without charging again", async () => {
    await armFault(getDb(), "access_storage_error");
    const orderId = await buy(await newBuyer(), "Home brake care guide");
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(0);
    const proposal = await proposeAction(owner, { action: "retry_access", targetId: orderId });
    expect(await decideProposal(owner, { proposalId: proposal.proposalId, approve: true })).toMatchObject({ state: "executed" });
    expect(await getDb().select().from(accessGrant).where(eq(accessGrant.orderId, orderId))).toHaveLength(1);
  });
});

describe("buyer tools", () => {
  it("let the model choose offers and quantities, while the server sets every price", async () => {
    const buyer = await newBuyer();
    const shop = await getSeller();
    if (!shop) throw new Error("no shop");
    const tools = buyerTools(buyer, shop);
    const mug = await offerId("Disc brake pads");
    const bowl = await offerId("Rechargeable");
    const first = (await tools.propose_quote.execute!({ mode: "replace", lines: [{ offerId: mug, quantity: 2 }], budgetMinor: null, deliveryRequested: false, buyerNote: null }, toolOptions)) as { totalMinor: number; quoteId: string };
    const second = (await tools.propose_quote.execute!({ mode: "add", lines: [{ offerId: bowl, quantity: 1 }], budgetMinor: null, deliveryRequested: false, buyerNote: null }, toolOptions)) as {
      totalMinor: number;
      lines: { offerId: string; quantity: number; lineTotalMinor: number }[];
    };
    const [mugRow] = await getDb().select().from(offer).where(eq(offer.id, mug));
    const [bowlRow] = await getDb().select().from(offer).where(eq(offer.id, bowl));
    expect(first.totalMinor).toBe(mugRow!.unitAmountMinor! * 2);
    expect(second.lines.map((line) => [line.offerId, line.quantity])).toEqual([
      [mug, 2],
      [bowl, 1],
    ]);
    expect(second.totalMinor).toBe(mugRow!.unitAmountMinor! * 2 + bowlRow!.unitAmountMinor!);
  });

  it("never offer an unpublished item", async () => {
    const buyer = await newBuyer();
    const shop = await getSeller();
    if (!shop) throw new Error("no shop");
    const mug = await offerId("Disc brake pads");
    await getDb().update(offer).set({ published: false }).where(eq(offer.id, mug));
    const result = (await buyerTools(buyer, shop).browse_catalog.execute!({ request: "a coffee mug", maxPriceMinor: null, kind: null }, toolOptions)) as { offers: { offerId: string }[] };
    expect(result.offers.length).toBeGreaterThan(0);
    expect(result.offers.map((offer) => offer.offerId)).not.toContain(mug);
  });
});

describe("list import", () => {
  it("reads lines, tabs, quotes, types and bad prices", () => {
    const rows = parseOfferList('Speckled cup, $22, 8\n"Planter, large",140\nGlaze workshop, 65, , service\nPattern sheets, 12, download\nBroken, twelve', "USD");
    expect(rows.map((row) => [row.title, row.kind, row.unitAmountMinor, row.stock, row.problem])).toEqual([
      ["Speckled cup", "goods", 2200, 8, null],
      ["Planter, large", "goods", 14000, null, null],
      ["Glaze workshop", "service", 6500, null, null],
      ["Pattern sheets", "digital", 1200, null, null],
      ["Broken", "goods", null, null, "Enter a positive price in USD, up to 100,000."],
    ]);
  });

  it("creates unpublished drafts and skips lines with problems", async () => {
    const shop = await getSeller();
    if (!shop) throw new Error("no shop");
    const preview = await previewOfferImport(owner, shop, "Speckled cup, 22, 8\nBroken, twelve\nGlaze workshop, 65, service");
    const result = await importOfferDrafts(owner, shop, { draftId: preview.draftId, reviewRevision: preview.reviewRevision });
    expect(result).toEqual({ created: 2, skipped: 1 });
    const drafts = await getDb().select().from(offer).where(eq(offer.title, "Speckled cup"));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.published).toBe(false);
  });
});
