/** Real PostgreSQL controls for request-owned database adapters. */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { createDb, getDb } from "@/server/db/client";
import { seller } from "@/server/db/schema";
import { allowedFrameOrigins, forgetFrameOrigins } from "@/server/http/frame-policy";
import { getPayPal } from "@/server/paypal";
import { withRequestDatabase } from "@/server/request-scope";
import { resetShop } from "../support/shop";
import { TEST_DATABASE_URL } from "../support/test-env";

beforeEach(resetShop);

describe("request-owned database adapters", () => {
  it("isolates overlapping requests and restores Node's process database", async () => {
    const processDb = getDb();
    const first = createDb(TEST_DATABASE_URL, 1);
    const second = createDb(TEST_DATABASE_URL, 1);
    try {
      const results = await Promise.all([first, second].map(({ db }) => withRequestDatabase(db, async () => {
        const before = getDb();
        const result = await getDb().execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        expect(getDb() === db).toBe(true);
        expect(before === db).toBe(true);
        return result.rows[0]!.pid;
      })));
      expect(results[0]).not.toBe(results[1]);
      expect(getDb() === processDb).toBe(true);
    } finally { await Promise.all([first.pool.end(), second.pool.end()]); }
  });

  it("does not retain an ended request's auth or simulated-payment adapter", async () => {
    const first = createDb(TEST_DATABASE_URL, 1);
    const second = createDb(TEST_DATABASE_URL, 1);
    try {
      const previous = await withRequestDatabase(first.db, async () => {
        const auth = getAuth();
        await auth.$context;
        return { auth, paypal: getPayPal() };
      });
      await first.pool.end();
      await withRequestDatabase(second.db, async () => {
        const auth = getAuth();
        const paypal = getPayPal();
        expect(auth === previous.auth).toBe(false);
        expect(paypal === previous.paypal).toBe(false);
        expect(getAuth() === auth).toBe(true);
        expect(getPayPal() === paypal).toBe(true);
        const context = await auth.$context;
        const users = await context.internalAdapter.findUserByEmail("owner@example.test");
        expect(users?.user.email).toBe("owner@example.test");
      });
    } finally {
      if (!first.pool.ended) await first.pool.end();
      await second.pool.end();
    }
  });

  it("reads embedding permissions again in a new invocation", async () => {
    const first = createDb(TEST_DATABASE_URL, 1);
    const second = createDb(TEST_DATABASE_URL, 1);
    try {
      await first.db.update(seller).set({ allowedOrigins: ["https://first.example.com"] });
      await withRequestDatabase(first.db, async () => {
        expect(await allowedFrameOrigins()).toEqual(["https://first.example.com"]);
      });
      await first.pool.end();
      await second.db.update(seller).set({ allowedOrigins: ["https://second.example.com"] });
      await withRequestDatabase(second.db, async () => {
        expect(await allowedFrameOrigins()).toEqual(["https://second.example.com"]);
        await second.db.update(seller).set({ allowedOrigins: [] });
        forgetFrameOrigins();
        expect(await allowedFrameOrigins()).toEqual([]);
      });
    } finally {
      if (!first.pool.ended) await first.pool.end();
      await second.pool.end();
      forgetFrameOrigins();
    }
  });
});
