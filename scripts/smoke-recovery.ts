/**
 * Recovery smoke test against a running fixture app: the buyer approves in
 * PayPal and closes the tab, so the return page never loads. A signed webhook
 * must finish the order; a forged or repeated webhook must change nothing; the
 * recovery job route must refuse callers without the jobs secret.
 *
 *   pnpm smoke:recovery [--offer "Disc brake pads"] [--base http://localhost:4310]
 */
import { parseArgs } from "node:util";
import { FIXTURE_SIGNATURE_HEADER, signFixtureWebhook } from "../src/fixtures/paypal-fixture";
import { loadLocalEnv } from "./lib/load-env";

loadLocalEnv();
const { values } = parseArgs({ options: { offer: { type: "string", default: "Disc brake pads" }, base: { type: "string", default: "http://localhost:4310" } } });
const base = values.base;
const jobsSecret = process.env.JOBS_SECRET ?? "";
if (!jobsSecret) throw new Error("JOBS_SECRET is not set in .env.local");

type Envelope<T> = { state: string; message: string; data: T | null };

async function call<T>(path: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function webhook(rawBody: string, signature: string) {
  const response = await fetch(`${base}/api/paypal/webhook`, { method: "POST", headers: { "Content-Type": "application/json", [FIXTURE_SIGNATURE_HEADER]: signature }, body: rawBody });
  return { status: response.status, body: (await response.json()) as { message: string } };
}

function step(label: string, detail: string) {
  console.log(`${label.padEnd(30)} ${detail}`);
}

function must<T>(value: T | null | undefined, why: string): T {
  if (value === null || value === undefined) throw new Error(why);
  return value;
}

const token = must((await call<{ token: string }>("/api/buyer/session", { method: "POST", json: { entry: "page" } })).body.data?.token, "session");
const offers = must((await call<{ offers: { id: string; title: string }[] }>("/api/buyer/catalog", { token })).body.data?.offers, "catalog");
const offer = must(offers.find((o) => o.title === values.offer), `offer ${values.offer}`);
const quote = must((await call<{ id: string; revision: number }>("/api/buyer/quote", { method: "POST", token, json: { lines: [{ offerId: offer.id, quantity: 1 }] } })).body.data, "quote");
const attempt = must(
  (await call<{ attemptId: string; approvalUrl: string }>("/api/buyer/checkout", { method: "POST", token, json: { quoteId: quote.id, revision: quote.revision } })).body.data,
  "checkout",
);
const providerOrderId = must(attempt.approvalUrl.split("/").pop(), "provider order id");
step("checkout", `attempt ${attempt.attemptId.slice(0, 8)}, PayPal order ${providerOrderId}`);

const approved = await fetch(`${base}/api/fixture/paypal/${providerOrderId}`, { method: "POST", body: new URLSearchParams({ decision: "approve" }), redirect: "manual" });
step("buyer approves, closes tab", `${approved.status}; return page never loaded`);

const before = await call<{ state: string }>(`/api/buyer/payment/${attempt.attemptId}`, { token });
step("state before webhook", before.body.data?.state ?? before.body.message);

const event = JSON.stringify({
  id: `WH-FIXTURE-${providerOrderId}`,
  event_type: "CHECKOUT.ORDER.APPROVED",
  resource_type: "checkout-order",
  resource: { id: providerOrderId, status: "APPROVED" },
});

const forged = await webhook(event, "0".repeat(64));
step("control: forged signature", `${forged.status} ${forged.body.message} (expected 401)`);

const delivered = await webhook(event, signFixtureWebhook(event, jobsSecret));
step("signed webhook", `${delivered.status} ${delivered.body.message}`);

const after = await call<{ state: string; headline: string }>(`/api/buyer/payment/${attempt.attemptId}`, { token });
step("state after webhook", `${after.body.data?.state} "${after.body.data?.headline}"`);

const repeated = await webhook(event, signFixtureWebhook(event, jobsSecret));
step("control: same event again", `${repeated.status} ${repeated.body.message} (expected Already received)`);

const anonymous = await fetch(`${base}/api/jobs/reconcile`, { method: "POST" });
step("control: jobs without secret", `${anonymous.status} (expected 401)`);
const wrong = await fetch(`${base}/api/jobs/reconcile`, { method: "POST", headers: { Authorization: "Bearer not-the-secret" } });
step("control: jobs wrong secret", `${wrong.status} (expected 401)`);
const run = await fetch(`${base}/api/jobs/reconcile`, { method: "POST", headers: { Authorization: `Bearer ${jobsSecret}` } });
step("jobs run", `${run.status} ${JSON.stringify(await run.json())}`);
