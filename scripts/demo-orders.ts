/**
 * Fills a fixture shop with a few real orders so the desk has work on it:
 * a brake check (a time to confirm) and the sample pack whose first access
 * attempt fails (a download to retry). Every order goes through the buyer API
 * and the fixture PayPal approval, the same path a person takes.
 *
 *   pnpm demo:orders [--base http://localhost:4310]
 *
 * Fixture mode only. Nothing here talks to PayPal.
 */
import { parseArgs } from "node:util";
import { armFault } from "../src/fixtures/paypal-fixture";
import { closeDb, getDb } from "../src/server/db/client";
import { loadLocalEnv } from "./lib/load-env";

loadLocalEnv();
if (process.env.APP_MODE !== "fixture") {
  console.error("demo:orders only runs with APP_MODE=fixture.");
  process.exit(1);
}

const { values } = parseArgs({ options: { base: { type: "string", default: "http://localhost:4310" } } });
const base = values.base;

type Envelope<T> = { state: string; message: string; data: T | null };

async function call<T>(path: string, init: { method?: string; token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  return (await response.json()) as Envelope<T>;
}

async function buy(title: string, note?: string): Promise<string> {
  const session = await call<{ token: string }>("/api/buyer/session", { method: "POST", json: { entry: "page" } });
  const token = session.data?.token;
  if (!token) throw new Error(`session: ${session.message}`);
  const catalog = await call<{ offers: { id: string; title: string }[] }>("/api/buyer/catalog", { token });
  const offer = catalog.data?.offers.find((item) => item.title === title);
  if (!offer) throw new Error(`"${title}" is not published in this shop`);
  const quote = await call<{ id: string; revision: number; status: string }>("/api/buyer/quote", {
    method: "POST",
    token,
    json: { lines: [{ offerId: offer.id, quantity: 1 }], ...(note ? { buyerNote: note } : {}) },
  });
  if (quote.data?.status !== "review_ready") throw new Error(`"${title}" quote is ${quote.data?.status ?? quote.message}`);
  const checkout = await call<{ attemptId: string; approvalUrl: string | null }>("/api/buyer/checkout", { method: "POST", token, json: { quoteId: quote.data.id, revision: quote.data.revision } });
  const approvalUrl = checkout.data?.approvalUrl;
  if (!checkout.data || !approvalUrl) throw new Error(`checkout: ${checkout.message}`);
  await fetch(`${base}/api/fixture/paypal/${approvalUrl.split("/").pop()}`, { method: "POST", body: new URLSearchParams({ decision: "approve" }), redirect: "manual" });
  const paid = await call<{ state: string; order: { number: number } | null }>("/api/buyer/capture", { method: "POST", token, json: { attemptId: checkout.data.attemptId } });
  if (!paid.data?.order) throw new Error(`capture: ${paid.data?.state ?? paid.message}`);
  return `#${paid.data.order.number} ${title}`;
}

try {
  console.log(`paid ${await buy("Brake check", "Front brake squeals when wet.")}  (desk: confirm a time)`);
  await armFault(getDb(), "access_storage_error");
  console.log(`paid ${await buy("Home brake care guide")}  (first access attempt fails on purpose; desk: retry access)`);
} finally {
  await closeDb();
}
