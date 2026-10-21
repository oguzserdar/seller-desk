/**
 * Test helpers over the real domain operations and the real test database.
 * Nothing here is mocked: PayPal is the fixture transport the app itself uses
 * in fixture mode, and every assertion reads PostgreSQL.
 */
import { and, count, eq, isNotNull, like, sql } from "drizzle-orm";
import { decideFixtureOrder } from "@/fixtures/paypal-fixture";
import { seedShop } from "@/fixtures/seed";
import { getDb } from "@/server/db/client";
import { fixtureProviderOrder, inventory, offer, orders, paymentAttempt } from "@/server/db/schema";
import { resolveBuyer, startBuyerSession } from "@/server/domain/buyer-session";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { proposeQuote } from "@/server/domain/quotes";
import { type PaymentView, startCheckout } from "@/server/payments/engine";

export const TEST_OWNER_PASSWORD = "test-owner-password-123";

/** Empties every app table and reseeds the showcase shop. */
export async function resetShop(): Promise<{ owner: OwnerPrincipal }> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'installation'`,
  );
  await db.execute(sql.raw(`truncate ${rows.map((row) => `"${row.tablename}"`).join(", ")} restart identity cascade`));
  const seeded = await seedShop({ preset: "showcase", origins: ["http://localhost:4311"], fixturePassword: TEST_OWNER_PASSWORD });
  if (seeded.outcome !== "seeded") throw new Error("seed did not run on an empty shop");
  return { owner: seeded.owner };
}

export async function newBuyer(entry: "page" | "widget" = "page"): Promise<BuyerPrincipal & { token: string }> {
  const issued = await startBuyerSession(entry);
  return { ...(await resolveBuyer(issued.token)), token: issued.token };
}

/** Turns a showcase service into a custom-price job, the kind the seller quotes before payment. */
export async function quoteEachJob(titlePrefix: string): Promise<string> {
  const id = await offerId(titlePrefix);
  await getDb().update(offer).set({ unitAmountMinor: null, requiresScopeReview: true }).where(eq(offer.id, id));
  return id;
}

export async function offerId(titlePrefix: string): Promise<string> {
  const [row] = await getDb().select({ id: offer.id }).from(offer).where(like(offer.title, `${titlePrefix}%`));
  if (!row) throw new Error(`no offer starting with ${titlePrefix}`);
  return row.id;
}

export async function quoteFor(buyer: BuyerPrincipal, titlePrefix: string, quantity = 1) {
  return proposeQuote(buyer, { lines: [{ offerId: await offerId(titlePrefix), quantity }] });
}

/** Quote + checkout in one step; returns the payment view (order_created on success). */
export async function checkoutFor(buyer: BuyerPrincipal, titlePrefix: string, quantity = 1): Promise<PaymentView> {
  const quote = await quoteFor(buyer, titlePrefix, quantity);
  if (quote.status !== "review_ready") throw new Error(`quote not ready: ${quote.status}`);
  return startCheckout(buyer, { quoteId: quote.id, revision: quote.revision });
}

export function providerOrderOf(view: PaymentView): string {
  const id = view.approvalUrl?.split("/").pop();
  if (!id) throw new Error(`no approval link (state ${view.state})`);
  return id;
}

/** The payer approves on the fixture PayPal page. */
export async function approveAtPayPal(view: PaymentView): Promise<void> {
  const row = await decideFixtureOrder(getDb(), providerOrderOf(view), "approve");
  if (row?.status !== "APPROVED") throw new Error("fixture approval failed");
}

export async function stockOf(titlePrefix: string) {
  const [row] = await getDb().select().from(inventory).where(eq(inventory.offerId, await offerId(titlePrefix)));
  if (!row) throw new Error(`no stock row for ${titlePrefix}`);
  return { total: row.total, held: row.held, sold: row.sold };
}

/** Counts that must never exceed one per purchase. */
export async function tally() {
  const db = getDb();
  const [orderCount] = await db.select({ n: count() }).from(orders);
  const [captures] = await db.select({ n: count() }).from(fixtureProviderOrder).where(isNotNull(fixtureProviderOrder.captureId));
  const [providerOrders] = await db.select({ n: count() }).from(fixtureProviderOrder);
  const [attempts] = await db.select({ n: count() }).from(paymentAttempt);
  return { orders: orderCount?.n ?? 0, captures: captures?.n ?? 0, providerOrders: providerOrders?.n ?? 0, attempts: attempts?.n ?? 0 };
}

export async function attemptRow(attemptId: string) {
  const [row] = await getDb().select().from(paymentAttempt).where(eq(paymentAttempt.id, attemptId));
  if (!row) throw new Error("attempt missing");
  return row;
}

/** Makes an attempt due for the job runner now (instead of waiting for backoff). */
export async function makeDue(attemptId: string): Promise<void> {
  await getDb().update(paymentAttempt).set({ nextCheckAt: sql`now() - interval '1 second'`, leaseExpiresAt: null }).where(eq(paymentAttempt.id, attemptId));
}

export async function expireHolds(quoteId: string): Promise<void> {
  await getDb().execute(sql`update reservation set expires_at = now() - interval '1 second' where quote_id = ${quoteId}`);
}

export { and, eq };
