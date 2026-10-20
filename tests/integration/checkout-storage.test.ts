import { count, eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getDb, transaction } from "@/server/db/client";
import { auditEvent, conversation, paymentAttempt, quote, reservation } from "@/server/db/schema";
import { ensureConversation } from "@/server/ai/conversation";
import { claimTurn } from "@/server/ai/turn-control";
import { startCheckout } from "@/server/payments/engine";
import { attemptRow, newBuyer, quoteFor, resetShop, stockOf, tally } from "../support/shop";

beforeEach(async () => { await resetShop(); });

it("cannot join an existing attempt with a buyer principal scoped to another shop", async () => {
  const buyer = await newBuyer();
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  const input = { quoteId: reviewed.id, revision: reviewed.revision };
  await startCheckout(buyer, input);
  await expect(startCheckout({ ...buyer, sellerId: crypto.randomUUID() }, input)).rejects.toMatchObject({ code: "not_found" });
  expect(await tally()).toMatchObject({ attempts: 1, providerOrders: 1 });
  expect((await stockOf("Disc brake pads")).held).toBe(1);
});

it("a revoked assistant claim cannot reserve stock or save a payment intent", async () => {
  const buyer = await newBuyer();
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  await expect(startCheckout({ ...buyer, assistantTurn: { conversationId: crypto.randomUUID(), id: crypto.randomUUID() } }, {
    quoteId: reviewed.id, revision: reviewed.revision,
  })).rejects.toMatchObject({ name: "AssistantTurnEnded" });
  expect(await tally()).toMatchObject({ attempts: 0, providerOrders: 0 });
  expect((await stockOf("Disc brake pads")).held).toBe(0);
});

it("allows an active assistant claim, but rejects that claim after expiry even when an attempt already exists", async () => {
  const buyer = await newBuyer();
  const id = await ensureConversation(buyer);
  const assistantTurn = (await claimTurn(buyer, id))!;
  const assistant = { ...buyer, assistantTurn };
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  const input = { quoteId: reviewed.id, revision: reviewed.revision };
  const view = await startCheckout(assistant, input);
  expect(view.state).toBe("order_created");
  await getDb().update(conversation).set({ activeTurnExpiresAt: new Date(Date.now() - 1000) }).where(eq(conversation.id, id));
  await expect(startCheckout(assistant, input)).rejects.toMatchObject({ name: "AssistantTurnEnded" });
  expect((await startCheckout(buyer, input)).attemptId).toBe(view.attemptId);
  expect(await tally()).toMatchObject({ attempts: 1, providerOrders: 1, captures: 0 });
});

it("a seller takeover that wins the database lock prevents a waiting checkout from committing", async () => {
  const buyer = await newBuyer();
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  const id = await ensureConversation(buyer);
  const assistantTurn = (await claimTurn(buyer, id))!;
  let pending!: Promise<unknown>;
  await transaction(getDb(), async (tx) => {
    await tx.select().from(conversation).where(eq(conversation.id, id)).for("update");
    pending = startCheckout({ ...buyer, assistantTurn }, { quoteId: reviewed.id, revision: reviewed.revision }).catch((error: unknown) => error);
    await tx.update(conversation).set({ handler: "seller", activeTurnId: null, activeTurnExpiresAt: null, controlRevision: 2 }).where(eq(conversation.id, id));
  });
  expect(await pending).toMatchObject({ name: "AssistantTurnEnded" });
  expect(await tally()).toMatchObject({ attempts: 0, providerOrders: 0 });
  expect((await stockOf("Disc brake pads")).held).toBe(0);
});

it("payment intent, stock, reservation, quote acceptance and audit commit together", async () => {
  const buyer = await newBuyer();
  const reviewed = await quoteFor(buyer, "Disc brake pads");
  const db = getDb();
  await db.execute(sql.raw(`CREATE FUNCTION reject_checkout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.operation = 'checkout.start' THEN RAISE EXCEPTION 'checkout audit injected failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_checkout_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_checkout_audit();`));
  try {
    await expect(startCheckout(buyer, { quoteId: reviewed.id, revision: reviewed.revision })).rejects.toThrow();
    expect(await tally()).toMatchObject({ attempts: 0, providerOrders: 0 });
    expect((await stockOf("Disc brake pads")).held).toBe(0);
    expect((await db.select().from(quote).where(eq(quote.id, reviewed.id)))[0]?.status).toBe("review_ready");
    expect((await db.select({ n: count() }).from(reservation))[0]?.n).toBe(0);
  } finally {
    await db.execute(sql.raw("DROP TRIGGER reject_checkout_audit ON audit_event; DROP FUNCTION reject_checkout_audit();"));
  }
  const view = await startCheckout(buyer, { quoteId: reviewed.id, revision: reviewed.revision });
  const attempt = await attemptRow(view.attemptId);
  expect(attempt.createRequestHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.select().from(paymentAttempt))).toHaveLength(1);
  expect((await db.select().from(reservation))).toHaveLength(1);
  expect((await db.select().from(auditEvent).where(eq(auditEvent.operation, "checkout.start")))).toHaveLength(1);
});
