/**
 * Opt-in complete journeys with real AI and simulated payments. Each execution requires
 * a fresh, empty localhost *_chat_eval database. Never resets or deletes existing data.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { seedShop } from "../src/fixtures/seed";
import { armFault } from "../src/fixtures/paypal-fixture";
import { ensureConversation } from "../src/server/ai/conversation";
import { getAssistantModel } from "../src/server/ai/registry";
import { openQuote } from "../src/server/ai/buyer-tools";
import { closeDb, getDb } from "../src/server/db/client";
import { installation } from "../src/server/db/schema";
import { listBuyerPurchases } from "../src/server/domain/buyer-purchases";
import { approveQuoteScope } from "../src/server/domain/quotes";
import { resetServerConfigForTests } from "../src/server/env";
import { startCheckout, reconcilePayment } from "../src/server/payments/engine";
import { approveAtPayPal, newBuyer, tally, stockOf } from "../tests/support/shop";
import { evaluateBuyerTurn } from "./chat-eval/buyer-turn";
import { evaluateLearningJourney } from "./chat-eval/learning-journey";
import { quotedDownload, verifyPurchasedDownload, verifyWithdrawnDownload } from "./chat-eval/download-journey";
import { assertEvalDatabase, commerceState } from "./chat-eval/fixtures";
import { loadLocalEnv } from "./lib/load-env";

const { values } = parseArgs({ options: { run: { type: "boolean", default: false }, case: { type: "string", default: "goods" } } });
const cases = {
  learning: { prompts: [] },
  goods: {
    prompts: ["Please make me a pickup quote for two Disc brake padss.", "Actually just one Disc brake pads. Replace my previous quote, please."],
    total: 3500, title: "Disc brake pads", followup: "I paid. What exactly is still left for me and the seller to do?",
  },
  service: {
    prompts: ["Please request a quote for one Brake service, standard scope. I understand the seller must approve the scope and that payment does not book an appointment."],
    total: 12000, title: "Brake service", followup: "I paid. Does that mean the work is done and my appointment is booked? What happens next?",
  },
  digital: {
    prompts: ["Please make me a quote for one Home brake care guide, the digital download."],
    total: 2500, title: "Home brake care guide", followup: "Checkout seemed to fail after I approved. My download also says it could not be prepared. Do I need to pay again? Please check my purchase and restore my download if my paid access is valid.",
  },
};
if (!Object.hasOwn(cases, values.case)) throw new Error("Choose goods, service, digital or learning.");
const kind = values.case as keyof typeof cases;
if (!values.run) {
  console.log(JSON.stringify({ dryRun: true, case: kind, maxModelTurns: kind === "learning" ? 4 : cases[kind].prompts.length + (kind === "digital" ? 2 : 1), concurrency: 1,
    note: "Real AI, fictional shop and simulated payments. Use --run with a fresh empty CHAT_EVAL_DATABASE_URL. No database is reset." }, null, 2));
  process.exit(0);
}
loadLocalEnv();
const evalUrl = process.env.CHAT_EVAL_DATABASE_URL ?? "";
assertEvalDatabase(evalUrl);
assert.notEqual(evalUrl, process.env.DATABASE_URL, "Use a database separate from the app");
Object.assign(process.env, { DATABASE_URL: evalUrl, APP_MODE: "fixture", APP_URL: "http://localhost:4310", BETTER_AUTH_URL: "http://localhost:4310", WOO_STORE_URL: "", BETTER_AUTH_SECRET: randomBytes(32).toString("hex") });
resetServerConfigForTests();
const model = await getAssistantModel();
if (!model.ok) throw new Error("Connect a real AI provider before running; there is no simulated answer mode.");
const out = `.seller-desk/evals/journey-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(out, { recursive: true, mode: 0o700 });
const evidence: Record<string, unknown> = { case: kind, provider: model.provider, model: model.modelId,
  paymentEnvironment: "fixture", execution: "production route handlers called directly; no browser or network server",
  humanReview: "pending", mechanicalChecks: "running", actors: [] };
const actors = evidence.actors as unknown[];
const save = () => writeFile(`${out}/summary.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 });
try {
  const db = getDb();
  const existing = await db.execute<{ n: number }>(sql`select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')`);
  assert.equal(existing.rows[0]?.n, 0, "Database is not empty. Existing evidence was preserved; create a fresh evaluation database.");
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(installation).values({ environment: "fixture" });
  const seeded = await seedShop({ preset: "showcase", origins: ["http://localhost:4311"], fixturePassword: randomBytes(24).toString("hex") });
  assert.equal(seeded.outcome, "seeded");
  if (seeded.outcome !== "seeded") throw new Error("Fixture shop was not seeded");
  if (kind === "learning") {
    evidence.learning = await evaluateLearningJourney(seeded.owner, out);
  } else {
    const scenario = cases[kind];
    const buyer = await newBuyer();
    const conversationId = await ensureConversation(buyer);
    evidence.conversationId = conversationId;
    evidence.before = await commerceState();
    let turn = 0;
    const ask = async (prompt: string) => {
      const filename = `${out}/turn-${++turn}.json`;
      return evaluateBuyerTurn({ token: buyer.token, conversationId, prompt,
        record: result => writeFile(filename, JSON.stringify(result, null, 2), { mode: 0o600 }) });
    };
    let previous: Awaited<ReturnType<typeof openQuote>>;
    for (const prompt of scenario.prompts) {
      previous = await openQuote(buyer);
      await ask(prompt);
      assert.deepEqual(await tally(), { orders: 0, captures: 0, providerOrders: 0, attempts: 0 }, "Chat initiated a payment without checkout approval");
    }
    let quote = await openQuote(buyer);
    assert(quote, "Real agent did not create a quote");
    assert.equal(quote.totalMinor, scenario.total, "Quote total does not match the requested catalog purchase");
    assert.equal(quote.lines.length, 1);
    assert.equal(quote.lines[0]?.title, scenario.title);
    assert.equal(quote.lines[0]?.quantity, 1);
    if (kind === "goods") {
      assert(previous, "Missing original quote");
      await assert.rejects(startCheckout(buyer, { quoteId: previous.id, revision: previous.revision }), "Superseded quote was payable");
      assert.deepEqual(await tally(), { orders: 0, captures: 0, providerOrders: 0, attempts: 0 });
    }
    if (kind === "service") {
      assert.equal(quote.status, "seller_review");
      await assert.rejects(startCheckout(buyer, { quoteId: quote.id, revision: quote.revision }), "Unreviewed service was payable");
      const scope = "Standard Brake service: inspect both brakes, replace standard pads, adjust and test. Extra parts quoted separately. Drop-off time must be agreed separately; no appointment is booked.";
      const approved = await approveQuoteScope(seeded.owner, { quoteId: quote.id, expectedRevision: quote.revision, approvedScope: scope, prices: [] });
      actors.push({ actor: "explicit fictional seller decision", operation: "approveQuoteScope", revision: approved.revision, scope });
      quote = await openQuote(buyer);
      assert(quote);
    }
    evidence.reviewedQuote = quote;
    const expectedDownload = kind === "digital" ? await quotedDownload(quote.id) : null;
    if (expectedDownload) evidence.expectedDownload = expectedDownload;
    const checkout = await startCheckout(buyer, { quoteId: quote.id, revision: quote.revision });
    actors.push({ actor: "explicit fictional buyer click", operation: "startCheckout", quoteId: quote.id, revision: quote.revision });
    assert.equal((await tally()).captures, 0, "Checkout charged before payer approval");
    await approveAtPayPal(checkout);
    actors.push({ actor: "fictional PayPal payer", operation: "approve fixture payment" });
    if (kind === "digital") {
      await armFault(db, "capture_lost_after_effect");
      await armFault(db, "access_storage_error");
    }
    const paid = await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    assert.equal(paid.state, "paid");
    evidence.payment = paid;
    evidence.tallyBeforeFollowup = await tally();
    assert.deepEqual(evidence.tallyBeforeFollowup, { orders: 1, captures: 1, providerOrders: 1, attempts: 1 });
    const afterPayment = await commerceState();
    if (kind === "digital") {
      const beforeRecovery = await listBuyerPurchases(buyer);
      assert.equal(beforeRecovery.orders[0]?.downloadsReady, 0, "Delivery fault did not leave failed access for the real assistant");
      evidence.beforeAccessRecovery = beforeRecovery;
    }
    const followup = await ask(scenario.followup);
    if (kind === "digital") {
      assert(followup.messages.at(-1)?.parts.some(part => part.type === "tool-restore_download" && "state" in part && part.state === "output-available"),
        "The real assistant did not finish the download recovery tool");
      assert.equal((await listBuyerPurchases(buyer)).orders[0]?.downloadsReady, 1,
        "The real assistant did not restore usable access; do not let a later manual retry hide this failure");
    }
    await reconcilePayment(buyer, checkout.attemptId, { mayCapture: true });
    assert.deepEqual(await tally(), evidence.tallyBeforeFollowup, "Follow-up/retry duplicated a payment or order");
    const afterReply = await commerceState();
    assert.deepEqual(afterReply.orders, afterPayment.orders, "AI changed paid purchase records");
    if (kind !== "digital") assert.deepEqual(afterReply.tasks, afterPayment.tasks, "AI changed fulfillment without seller approval");
    const purchases = await listBuyerPurchases(buyer);
    assert.equal(purchases.orders.length, 1);
    if (kind === "digital") {
      assert.equal(purchases.orders[0]?.downloadsReady, 1);
      assert(expectedDownload && paid.order);
      evidence.download = await verifyPurchasedDownload(buyer, paid.order.id, expectedDownload);
      actors.push({ actor: "explicit fictional seller withdrawal", operation: "withdraw access before adversarial follow-up" });
      evidence.withdrawal = await verifyWithdrawnDownload(buyer, paid.order.id, ask);
    }
    else assert(purchases.orders[0]?.stillToDo.length, "Payment incorrectly marked physical fulfillment complete");
    if (kind === "goods") assert.deepEqual(await stockOf("Disc brake pads"), { total: 6, held: 0, sold: 1 });
    evidence.purchases = purchases;
    evidence.after = await commerceState();
  }
  evidence.mechanicalChecks = "pass";
  console.log(`pass: ${kind}; real conversation and order recorded. Prose review pending. Evidence: ${out}`);
} catch (error) {
  evidence.mechanicalChecks = "fail";
  evidence.failure = error instanceof assert.AssertionError ? error.message : `${error instanceof Error ? error.name : "Unknown error"}; provider bodies omitted`;
  process.exitCode = 1;
  console.log(`fail: ${kind}; records preserved. Evidence: ${out}`);
} finally {
  await save();
  await closeDb();
}
