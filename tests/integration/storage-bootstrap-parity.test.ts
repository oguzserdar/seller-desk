import { getAuth } from "@/server/auth/auth";
import { bootstrapOwner, resetOwnerPassword } from "@/server/auth/bootstrap";
import { getSeller } from "@/server/domain/seller";
import { withD1Database } from "@/server/request-scope";
import { createD1Db } from "@/server/storage/d1/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  newStorageFixture,
  type StorageFixture,
} from "../support/storage-fixture";
const password = "storage-fixture-only-password",
  changed = "storage-fixture-changed-password";
for (const dialect of ["postgres", "d1"] as const)
  describe(`${dialect}: operator owner setup`, () => {
    let f: StorageFixture;
    beforeEach(async () => {
      f = await newStorageFixture(dialect);
      for (const table of [
        "inventory",
        "offer",
        "digital_asset",
        "buyer_session",
        "seller",
        "user",
      ])
        await f.query(`delete from "${table}"`);
    });
    afterEach(async () => {
      await f?.close();
    });
    const run = <T>(work: () => Promise<T>) =>
      f.binding ? withD1Database(createD1Db(f.binding), work) : work();
    const input = (email = "owner@bootstrap.example.test") => ({
      email,
      password,
      displayName: "Owner setup shop",
      country: "CA",
      currency: "USD",
    });
    const count = async (table: string) =>
      Number((await f.query(`select count(*) n from "${table}"`))[0]!.n);
    it("does not leave login credentials behind if shop creation fails", async () => {
      await expect(
        run(() => bootstrapOwner({ ...input(), country: "INVALID" })),
      ).rejects.toThrow();
      expect(await count("seller")).toBe(0);
      expect(await count("user")).toBe(0);
      expect(await count("account")).toBe(0);
    });
    it("creates one owner, signs in with real Better Auth, resets the password and revokes existing sessions", async () => {
      const created = await run(() => bootstrapOwner(input()));
      expect(created.outcome).toBe("created");
      expect(
        (
          await run(() =>
            bootstrapOwner(input("another@bootstrap.example.test")),
          )
        ).outcome,
      ).toBe("exists");
      expect(await count("user")).toBe(1);
      const login = await run(() =>
        getAuth().api.signInEmail({
          body: { email: input().email, password },
          asResponse: true,
        }),
      );
      expect(login.status).toBe(200);
      expect(await count("session")).toBe(1);
      expect(await run(() => resetOwnerPassword(input().email, changed))).toBe(
        "reset",
      );
      expect(await count("session")).toBe(0);
      const failed = await run(() =>
        getAuth().api.signInEmail({
          body: { email: input().email, password },
          asResponse: true,
        }),
      );
      expect(failed.status).toBe(401);
      expect(
        (
          await run(() =>
            getAuth().api.signInEmail({
              body: { email: input().email, password: changed },
              asResponse: true,
            }),
          )
        ).status,
      ).toBe(200);
      expect((await run(() => getSeller()))!.displayName).toBe(
        "Owner setup shop",
      );
    });
    it("revokes a previously signed-in unowned account before linking it as the shop owner", async () => {
      const prior = await run(async () => {
        const ctx = await getAuth().$context;
        const user = await ctx.internalAdapter.createUser(
          {
            email: input().email,
            name: "Unowned setup account",
            emailVerified: true,
          },
          { method: "admin" },
        );
        await ctx.internalAdapter.linkAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: await ctx.password.hash(changed),
        });
        return getAuth().api.signInEmail({
          body: { email: input().email, password: changed },
          asResponse: true,
        });
      });
      expect(prior.status).toBe(200);
      expect(await count("session")).toBe(1);
      const cookie = prior.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect((await run(() => bootstrapOwner(input()))).outcome).toBe(
        "created",
      );
      expect(await count("session")).toBe(0);
      expect(
        await run(() =>
          getAuth().api.getSession({ headers: new Headers({ cookie }) }),
        ),
      ).toBeNull();
    });
    it("concurrent first installs create exactly one owner and no orphan credentials", async () => {
      const results = await Promise.allSettled([
        run(() => bootstrapOwner(input("a@bootstrap.example.test"))),
        run(() => bootstrapOwner(input("b@bootstrap.example.test"))),
      ]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(await count("seller")).toBe(1);
      expect(await count("user")).toBe(1);
      expect(await count("account")).toBe(1);
    });
  });
