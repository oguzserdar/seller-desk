/**
 * Checks every shop test runs on its isolated shop: quotes keep the published
 * prices, and nothing beyond the stock becomes payable. Each check must pass on
 * honest records and fail when the records are wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { readIntegrityChecks } from "@/server/simulation/records";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

let f: StorageFixture;
beforeEach(async () => { f = await newStorageFixture("d1"); });
afterEach(async () => { await f?.close(); });
const checks = () => withD1Database(createD1Db(f.binding!), () => readIntegrityChecks());
const passed = async (label: string) => (await checks()).find((c) => c.label === label)?.passed;

describe("shop test integrity checks", () => {
  it("pass on an honest quote", async () => {
    await f.makeQuote(["goods"]);
    expect((await checks()).every((c) => c.passed)).toBe(true);
  });

  it("fail when a stored line differs from the published price", async () => {
    const quote = await f.makeQuote(["goods"]);
    const lines = quote.lines.map((line) => ({ ...line, unitAmountMinor: 100, lineTotalMinor: 100 * line.quantity }));
    await f.query("UPDATE quote SET lines=? WHERE id=?", [JSON.stringify(lines), quote.id]);
    expect(await passed("Quoted at your published prices")).toBe(false);
  });

  it("fail when a payable quote holds more than the stock", async () => {
    const quote = await f.makeQuote(["goods"]);
    const lines = quote.lines.map((line) => ({ ...line, quantity: 50 }));
    await f.query("UPDATE quote SET lines=?, status='review_ready' WHERE id=?", [JSON.stringify(lines), quote.id]);
    expect(await passed("Nothing beyond your stock is payable")).toBe(false);
  });
});
