/**
 * The last unit of a one-of-a-kind item can be held by exactly one checkout,
 * whether the competitors share a process, use separate connection pools, or
 * run as separate app instances.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { proposeQuote } from "@/server/domain/quotes";
import { startCheckout } from "@/server/payments/engine";
import { newBuyer, offerId, resetShop, stockOf, tally } from "../support/shop";
import { TEST_DATABASE_URL, TEST_ENV } from "../support/test-env";

const BOWL = "Restored leather saddle";

describe("last item", () => {
  beforeEach(async () => {
    await resetShop();
  });

  it("two buyers in one instance: exactly one checkout holds the bowl, ten rounds", async () => {
    for (let round = 0; round < 10; round += 1) {
      if (round > 0) await resetShop();
      const bowl = await offerId(BOWL);
      const [a, b] = await Promise.all([newBuyer(), newBuyer()]);
      const [qa, qb] = await Promise.all([
        proposeQuote(a, { lines: [{ offerId: bowl, quantity: 1 }] }),
        proposeQuote(b, { lines: [{ offerId: bowl, quantity: 1 }] }),
      ]);
      expect([qa.status, qb.status]).toEqual(["review_ready", "review_ready"]);
      const results = await Promise.allSettled([
        startCheckout(a, { quoteId: qa.id, revision: qa.revision }),
        startCheckout(b, { quoteId: qb.id, revision: qb.revision }),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]?.reason).toBeInstanceOf(DomainError);
      expect((lost[0]?.reason as DomainError).code).toBe("sold_out");
      expect(await stockOf(BOWL)).toEqual({ total: 1, held: 1, sold: 0 });
      expect((await tally()).providerOrders).toBe(1);
    }
  });

  it("two independent connection pools: the guarded hold re-checks the row it waited for", async () => {
    const bowl = await offerId(BOWL);
    const one = createDb(TEST_DATABASE_URL, 1);
    const two = createDb(TEST_DATABASE_URL, 1);
    const c1 = await one.pool.connect();
    const c2 = await two.pool.connect();
    const hold = "update inventory set held = held + 1 where offer_id = $1 and total - held - sold >= 1 returning offer_id";
    try {
      await c1.query("begin");
      await c2.query("begin");
      const first = await c1.query(hold, [bowl]);
      const second = c2.query(hold, [bowl]); // blocks on the row lock until the first commits
      await c1.query("commit");
      const secondResult = await second;
      await c2.query("commit");
      expect(first.rowCount).toBe(1);
      expect(secondResult.rowCount).toBe(0);
    } finally {
      c1.release();
      c2.release();
      await one.pool.end();
      await two.pool.end();
    }
    expect(await stockOf(BOWL)).toEqual({ total: 1, held: 1, sold: 0 });
  });

  it("two separate app processes released together: one holds, one is told it sold out", async () => {
    const bowl = await offerId(BOWL);
    const [a, b] = await Promise.all([newBuyer(), newBuyer()]);
    const quotes = await Promise.all([a, b].map((buyer) => proposeQuote(buyer, { lines: [{ offerId: bowl, quantity: 1 }] })));
    const children = [a, b].map((buyer, i) => {
      const quote = quotes[i];
      if (!quote) throw new Error("quote missing");
      return spawn(process.execPath, ["--import", "tsx", "tests/support/checkout-child.ts", buyer.token, quote.id, String(quote.revision)], {
        env: { ...process.env, ...TEST_ENV },
        stdio: ["pipe", "pipe", "inherit"],
      });
    });
    const outputs = children.map((child) => {
      const lines = createInterface({ input: child.stdout });
      const ready = new Promise<void>((resolve) => lines.on("line", (line) => line === "ready" && resolve()));
      const result = new Promise<{ ok: boolean; code?: string }>((resolve) =>
        lines.on("line", (line) => {
          if (line.startsWith("{")) resolve(JSON.parse(line) as { ok: boolean; code?: string });
        }),
      );
      return { ready, result };
    });
    await Promise.all(outputs.map((o) => o.ready));
    for (const child of children) child.stdin.write("go\n");
    const results = await Promise.all(outputs.map((o) => o.result));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => r.code)).toEqual(["sold_out"]);
    expect(await stockOf(BOWL)).toEqual({ total: 1, held: 1, sold: 0 });
  }, 60_000);
});
