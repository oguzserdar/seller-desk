import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { firstOwnerSetupEnabled, installFirstOwner } from "@/server/auth/first-owner";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { newStorageFixture, type StorageFixture } from "../support/storage-fixture";

for (const dialect of ["postgres", "d1"] as const) describe(`${dialect}: protected browser installation`, () => {
  let fixture: StorageFixture;
  const token = "installation-test-only-independent-token-123456789";
  const input = () => ({ token, email: "isabel@example.test", password: "owner-test-only-password-123", displayName: "Isabel's shop", country: "CA", currency: "CAD" });
  const headers = (origin = "http://localhost:4310") => new Headers({ origin, "x-forwarded-for": "192.0.2.1" });
  const run = <T>(work: () => Promise<T>) => fixture.binding ? withD1Database(createD1Db(fixture.binding), work) : work();
  beforeEach(async () => {
    fixture = await newStorageFixture(dialect);
    for (const table of ["inventory", "offer", "digital_asset", "buyer_session", "seller", "user"]) await fixture.query(`DELETE FROM "${table}"`);
    process.env.INSTALL_TOKEN = token;
  });
  afterEach(async () => { delete process.env.INSTALL_TOKEN; await fixture?.close(); });
  it("rejects wrong origin, wrong token and disabled setup without creating any account", async () => {
    await expect(run(() => installFirstOwner(input(), headers("https://attacker.example.test")))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(run(() => installFirstOwner({ ...input(), token: "x".repeat(40) }, headers()))).rejects.toMatchObject({ code: "unauthorized" });
    delete process.env.INSTALL_TOKEN;
    await expect(run(() => installFirstOwner(input(), headers()))).rejects.toMatchObject({ code: "unavailable" });
    expect(Number((await fixture.query("SELECT count(*) n FROM account"))[0]!.n)).toBe(0);
  });
  it("creates the first owner who can really sign in, then refuses all setup attempts without changing credentials", async () => {
    expect(await run(() => installFirstOwner(input(), headers()))).toEqual({ created: true });
    const stored = await fixture.query("SELECT password FROM account");
    await expect(run(() => installFirstOwner({ ...input(), email: "other@example.test", password: "replacement-must-not-be-used" }, headers()))).rejects.toMatchObject({ code: "unavailable" });
    expect(await fixture.query("SELECT password FROM account")).toEqual(stored);
    const login = await run(() => getAuth().api.signInEmail({ body: { email: input().email, password: input().password }, asResponse: true }));
    expect(login.status).toBe(200);
    expect(Number((await fixture.query("SELECT count(*) n FROM seller"))[0]!.n)).toBe(1);
  });
  it("allows only one first owner under a race", async () => {
    const outcomes = await Promise.allSettled([run(() => installFirstOwner(input(), headers())), run(() => installFirstOwner({ ...input(), email: "another@example.test" }, headers()))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(Number((await fixture.query("SELECT count(*) n FROM seller"))[0]!.n)).toBe(1);
    expect(Number((await fixture.query("SELECT count(*) n FROM account"))[0]!.n)).toBe(1);
  });
  it("refuses reuse of the auth/job secret and limits failed token guesses", async () => {
    process.env.INSTALL_TOKEN = process.env.BETTER_AUTH_SECRET;
    expect(firstOwnerSetupEnabled()).toBe(false);
    process.env.INSTALL_TOKEN = process.env.JOBS_SECRET;
    expect(firstOwnerSetupEnabled()).toBe(false);
    process.env.INSTALL_TOKEN = token;
    for (let attempt = 0; attempt < 10; attempt++) await expect(run(() => installFirstOwner({ ...input(), token: "invalid-test-token-".repeat(3) }, headers()))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(run(() => installFirstOwner(input(), headers()))).rejects.toMatchObject({ code: "rate_limited" });
    expect(Number((await fixture.query("SELECT count(*) n FROM account"))[0]!.n)).toBe(0);
  });
});
