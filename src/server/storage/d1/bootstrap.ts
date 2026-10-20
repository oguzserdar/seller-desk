import { getAuth } from "@/server/auth/auth";
import type { BootstrapInput, BootstrapResult } from "@/server/auth/bootstrap";
import { account, seller, session, user } from "@/server/db/sqlite/schema";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, isBatchGuardFailure } from "./guards";
function mask(email: string) {
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 1) ?? ""}***@${domain ?? ""}`;
}
/** Operator-only owner creation/reset using Better Auth's configured password hasher and atomic native writes. */
export function createD1Bootstrap(db: D1Db) {
  async function existing() {
    const [row] = await db
      .select({ email: user.email })
      .from(seller)
      .innerJoin(user, eq(user.id, seller.ownerUserId));
    return row;
  }
  async function hash(password: string) {
    const ctx = await getAuth().$context;
    const { minPasswordLength, maxPasswordLength } = ctx.password.config;
    if (
      password.length < minPasswordLength ||
      password.length > maxPasswordLength
    )
      throw new Error(
        `The password must be ${minPasswordLength} to ${maxPasswordLength} characters.`,
      );
    return ctx.password.hash(password);
  }
  return {
    async bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
      const password = await hash(input.password),
        email = input.email.trim().toLowerCase();
      const prior = await existing();
      if (prior) return { outcome: "exists", ownerEmail: mask(prior.email) };
      const [found] = await db.select().from(user).where(eq(user.email, email));
      const userId = found?.id ?? crypto.randomUUID(),
        sellerId = crypto.randomUUID(),
        execution = crypto.randomUUID();
      const [credential] = found
        ? await db
            .select()
            .from(account)
            .where(
              and(
                eq(account.userId, userId),
                eq(account.providerId, "credential"),
              ),
            )
        : [];
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:empty`,
            sql`not exists(select 1 from seller)`,
          ),
          ...(!found
            ? [
                db.insert(user).values({
                  id: userId,
                  name: input.displayName,
                  email,
                  emailVerified: true,
                }),
              ]
            : []),
          credential
            ? db
                .update(account)
                .set({ password, updatedAt: new Date() })
                .where(eq(account.id, credential.id))
            : db.insert(account).values({
                id: crypto.randomUUID(),
                userId,
                accountId: userId,
                providerId: "credential",
                password,
              }),
          ...(found
            ? [db.delete(session).where(eq(session.userId, userId))]
            : []),
          db.insert(seller).values({
            id: sellerId,
            ownerUserId: userId,
            displayName: input.displayName,
            contactEmail: input.contactEmail ?? email,
            country: input.country,
            currency: input.currency,
          }),
          clearBatchGuards(db, execution),
        ]);
        return { outcome: "created", userId, sellerId };
      } catch (error) {
        if (isBatchGuardFailure(error)) {
          const winner = await existing();
          if (winner)
            return { outcome: "exists", ownerEmail: mask(winner.email) };
        }
        throw error;
      }
    },
    async resetOwnerPassword(
      email: string,
      password: string,
    ): Promise<"reset" | "not_owner"> {
      const [owner] = await db
        .select({ userId: user.id, accountId: account.id })
        .from(user)
        .innerJoin(seller, eq(seller.ownerUserId, user.id))
        .innerJoin(
          account,
          and(
            eq(account.userId, user.id),
            eq(account.providerId, "credential"),
          ),
        )
        .where(eq(user.email, email.trim().toLowerCase()));
      if (!owner) return "not_owner";
      const hashed = await hash(password),
        execution = crypto.randomUUID();
      await db.batch([
        batchGuard(
          db,
          `${execution}:owner`,
          sql`exists(select 1 from seller where owner_user_id=${owner.userId})`,
        ),
        db
          .update(account)
          .set({ password: hashed, updatedAt: new Date() })
          .where(eq(account.id, owner.accountId)),
        db.delete(session).where(eq(session.userId, owner.userId)),
        clearBatchGuards(db, execution),
      ]);
      return "reset";
    },
  };
}
