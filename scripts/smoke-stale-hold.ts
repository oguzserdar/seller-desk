/**
 * Last-item and stale-approval smoke test against a running fixture app.
 *
 * Buyer A starts checkout for a one-of-a-kind item and walks away. While A's
 * hold is live, buyer B sees it sold out. When the hold expires, B can buy it:
 * checkout settles A's attempt through PayPal first. A's late approval is then
 * never captured. Hold expiry is simulated by moving `expires_at` into the past
 * (Postgres `now()` cannot be faked).
 *
 *   pnpm smoke:stale-hold [--offer "Restored leather saddle"] [--base http://localhost:4310]
 */
import { parseArgs } from "node:util";
import pg from "pg";
import { loadLocalEnv } from "./lib/load-env";

loadLocalEnv();
const { values } = parseArgs({ options: { offer: { type: "string", default: "Restored leather saddle" }, base: { type: "string", default: "http://localhost:4310" } } });
const base = values.base;

type Envelope<T> = { state: string; message: string; data: T | null };
type Offer = { id: string; title: string; available: number | null };

async function call<T>(path: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

function step(label: string, detail: string) {
  console.log(`${label.padEnd(34)} ${detail}`);
}

function must<T>(value: T | null | undefined, why: string): T {
  if (value === null || value === undefined) throw new Error(why);
  return value;
}

async function buyer() {
  return must((await call<{ token: string }>("/api/buyer/session", { method: "POST", json: { entry: "page" } })).body.data?.token, "session");
}

async function find(token: string): Promise<Offer> {
  const offers = must((await call<{ offers: Offer[] }>("/api/buyer/catalog", { token })).body.data?.offers, "catalog");
  return must(offers.find((o) => o.title.startsWith(values.offer)), `offer ${values.offer}`);
}

async function quoteFor(token: string, offerId: string) {
  return must((await call<{ id: string; revision: number; status: string }>("/api/buyer/quote", { method: "POST", token, json: { lines: [{ offerId, quantity: 1 }] } })).body.data, "quote");
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const a = await buyer();
  const offer = await find(a);
  if (offer.available !== 1) throw new Error(`${offer.title} must have exactly one available to start (has ${offer.available}); reseed first`);
  step("A sees", `${offer.title}: available ${offer.available}`);

  const quoteA = await quoteFor(a, offer.id);
  const checkoutA = await call<{ attemptId: string; state: string; approvalUrl: string }>("/api/buyer/checkout", { method: "POST", token: a, json: { quoteId: quoteA.id, revision: quoteA.revision } });
  const attemptA = must(checkoutA.body.data, `A checkout: ${checkoutA.body.message}`);
  step("A starts checkout, walks away", `state ${attemptA.state}`);

  const b = await buyer();
  step("B sees (A's hold live)", `available ${(await find(b)).available}`);
  const blocked = await quoteFor(b, offer.id);
  step("B's quote while hold is live", `${blocked.status} (expected needs_information)`);

  await db.query("update reservation set expires_at = now() - interval '1 second' where quote_id = $1", [quoteA.id]);
  step("simulate: A's hold expires", "expires_at moved into the past");

  step("B sees (A's hold expired)", `available ${(await find(b)).available} (expected 1, nothing released yet)`);
  const quoteB = await quoteFor(b, offer.id);
  step("B's quote", quoteB.status);
  const checkoutB = await call<{ attemptId: string; state: string }>("/api/buyer/checkout", { method: "POST", token: b, json: { quoteId: quoteB.id, revision: quoteB.revision } });
  step("B checkout (settles A first)", `${checkoutB.status} ${checkoutB.body.data?.state ?? checkoutB.body.message}`);

  const viewA = await call<{ state: string; headline: string }>(`/api/buyer/payment/${attemptA.attemptId}`, { token: a });
  step("A's attempt now", `${viewA.body.data?.state} "${viewA.body.data?.headline}"`);

  const providerOrderA = must(attemptA.approvalUrl.split("/").pop(), "A provider order");
  const lateApproval = await fetch(`${base}/api/fixture/paypal/${providerOrderA}`, { method: "POST", body: new URLSearchParams({ decision: "approve" }), redirect: "manual" });
  const captureA = await call<{ state: string; headline: string }>("/api/buyer/capture", { method: "POST", token: a, json: { attemptId: attemptA.attemptId } });
  step("A approves late and returns", `approve ${lateApproval.status}; capture -> ${captureA.body.data?.state} "${captureA.body.data?.headline}"`);

  const captured = await db.query("select capture_id from fixture_provider_order where id = $1", [providerOrderA]);
  step("control: A's PayPal order captured?", captured.rows[0]?.capture_id ? "YES (defect)" : "no (expected)");
  const stock = await db.query("select i.total, i.held, i.sold from inventory i where i.offer_id = $1", [offer.id]);
  step("inventory", JSON.stringify(stock.rows[0]));
} finally {
  await db.end();
}
