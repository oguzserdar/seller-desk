/**
 * End-to-end fixture purchase over HTTP against a running app (APP_MODE=fixture).
 *
 *   pnpm smoke:purchase [--offer "Disc brake pads"] [--base http://localhost:4310]
 *
 * Walks the buyer path a person takes and prints each observed state, plus
 * three negative controls: an extra price field, a forged capture for an
 * unrelated buyer, and a duplicate checkout click.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { offer: { type: "string", default: "Rechargeable front light" }, base: { type: "string", default: "http://localhost:4310" } } });
const base = values.base;

type Envelope<T> = { state: string; message: string; next: string[]; data: T | null };

async function call<T>(path: string, init: { method?: string; token?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

function step(label: string, detail: string) {
  console.log(`${label.padEnd(28)} ${detail}`);
}

function must<T>(value: T | null | undefined, why: string): T {
  if (value === null || value === undefined) throw new Error(why);
  return value;
}

const session = await call<{ token: string }>("/api/buyer/session", { method: "POST", json: { entry: "page" } });
const token = must(session.body.data?.token, `session failed: ${session.body.message}`);
step("buyer session", `${session.status} capability issued`);

const catalog = await call<{ offers: { id: string; title: string; unitAmountMinor: number; available: number | null }[] }>("/api/buyer/catalog", { token });
const offer = must(catalog.body.data?.offers.find((o) => o.title === values.offer), `offer "${values.offer}" not found`);
step("catalog", `${catalog.body.data?.offers.length} offers; ${offer.title} available=${offer.available}`);

const tampered = await call("/api/buyer/quote", { method: "POST", token, json: { lines: [{ offerId: offer.id, quantity: 1 }], totalMinor: 1 } });
step("control: injected total", `${tampered.status} ${tampered.body.state} (expected 400 invalid)`);

const quote = await call<{ id: string; revision: number; status: string; totalMinor: number }>("/api/buyer/quote", { method: "POST", token, json: { lines: [{ offerId: offer.id, quantity: 1 }] } });
const q = must(quote.body.data, `quote failed: ${quote.body.message}`);
step("quote", `${quote.status} status=${q.status} total=${q.totalMinor}`);

const checkout = await call<{ attemptId: string; state: string; approvalUrl: string | null }>("/api/buyer/checkout", { method: "POST", token, json: { quoteId: q.id, revision: q.revision } });
const attempt = must(checkout.body.data, `checkout failed: ${checkout.body.message}`);
step("checkout", `${checkout.status} state=${attempt.state}`);

const duplicate = await call<{ attemptId: string }>("/api/buyer/checkout", { method: "POST", token, json: { quoteId: q.id, revision: q.revision } });
step("control: duplicate click", `same attempt: ${duplicate.body.data?.attemptId === attempt.attemptId}`);

const other = await call<{ token: string }>("/api/buyer/session", { method: "POST", json: { entry: "page" } });
const forged = await call("/api/buyer/capture", { method: "POST", token: must(other.body.data?.token, "second session"), json: { attemptId: attempt.attemptId } });
step("control: other buyer capture", `${forged.status} ${forged.body.state} (expected 404 not_found)`);

const approvalUrl = must(attempt.approvalUrl, "no approval url");
const providerOrderId = must(approvalUrl.split("/").pop(), "no provider order id");
const approve = await fetch(`${base}/api/fixture/paypal/${providerOrderId}`, { method: "POST", body: new URLSearchParams({ decision: "approve" }), redirect: "manual" });
step("fixture PayPal approval", `${approve.status} -> ${approve.headers.get("location")?.replace(base, "")}`);

const captured = await call<{ state: string; headline: string; order: { id: string; number: number } | null }>("/api/buyer/capture", { method: "POST", token, json: { attemptId: attempt.attemptId } });
const paid = must(captured.body.data, `capture failed: ${captured.body.message}`);
step("capture + verify", `${captured.status} state=${paid.state} "${paid.headline}"`);

const again = await call<{ state: string; order: { id: string } | null }>("/api/buyer/capture", { method: "POST", token, json: { attemptId: attempt.attemptId } });
step("control: capture replay", `state=${again.body.data?.state} same order=${again.body.data?.order?.id === paid.order?.id}`);

const orderId = must(paid.order?.id, "no order");
const order = await call<{ number: number; tasks: { label: string }[]; downloads: unknown[] }>(`/api/buyer/orders/${orderId}`, { token });
step("buyer order view", `#${order.body.data?.number}: ${order.body.data?.tasks.map((t) => t.label).join(" | ")}; downloads=${order.body.data?.downloads.length}`);

const noKey = await call(`/api/buyer/orders/${orderId}`);
step("control: order id alone", `${noKey.status} ${noKey.body.state} (expected 404)`);
