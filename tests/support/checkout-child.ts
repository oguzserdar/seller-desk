/**
 * A second app instance for the cross-process race test: its own Node process
 * and its own connection pool. It prints "ready", waits for "go" on stdin so
 * both instances start checkout together, then prints one JSON result line.
 */
import { createInterface } from "node:readline";
import { closeDb } from "../../src/server/db/client";
import { resolveBuyer } from "../../src/server/domain/buyer-session";
import { startCheckout } from "../../src/server/payments/engine";

const [token, quoteId, revision] = process.argv.slice(2);
const buyer = await resolveBuyer(token);
console.log("ready");
const lines = createInterface({ input: process.stdin });
for await (const line of lines) if (line.trim() === "go") break;
lines.close();
try {
  const view = await startCheckout(buyer, { quoteId: quoteId as string, revision: Number(revision) });
  console.log(JSON.stringify({ ok: true, state: view.state }));
} catch (error) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "error";
  console.log(JSON.stringify({ ok: false, code }));
} finally {
  await closeDb();
}
