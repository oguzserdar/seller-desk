import { getAuth } from "@/server/auth/auth";
import type { BootstrapInput, BootstrapResult } from "@/server/auth/bootstrap";
import { transaction, type Db } from "@/server/db/client";
import { account, seller, session, user } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
function mask(email: string) {
  const [name, domain] = email.split("@");
  return `${name?.slice(0, 1) ?? ""}***@${domain ?? ""}`;
}
function uniqueConflict(error: unknown) {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if ("code" in error && error.code === "23505") return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}
/** PostgreSQL owner setup commits credentials and the singleton shop together, using Better Auth's password hasher. */
export function createPostgresBootstrap(db: Db) {
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
  async function existing() {
    const [row] = await db
      .select({ email: user.email })
      .from(seller)
      .innerJoin(user, eq(user.id, seller.ownerUserId));
    return row;
  }
  return {
    async bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
      const password = await hash(input.password),
        email = input.email.trim().toLowerCase();
      try {
        return await transaction(db, async (tx) => {
          const [installed] = await tx
            .select({ email: user.email })
            .from(seller)
            .innerJoin(user, eq(user.id, seller.ownerUserId));
          if (installed)
            return {
              outcome: "exists" as const,
              ownerEmail: mask(installed.email),
            };
          const [prior] = await tx
            .select()
            .from(user)
            .where(eq(user.email, email))
            .for("update");
          const userId = prior?.id ?? crypto.randomUUID();
          if (!prior)
            await tx.insert(user).values({
              id: userId,
              name: input.displayName,
              email,
              emailVerified: true,
            });
          const [credential] = await tx
            .select()
            .from(account)
            .where(
              and(
                eq(account.userId, userId),
                eq(account.providerId, "credential"),
              ),
            );
          if (credential)
            await tx
              .update(account)
              .set({ password })
              .where(eq(account.id, credential.id));
          else
            await tx.insert(account).values({
              id: crypto.randomUUID(),
              userId,
              accountId: userId,
              providerId: "credential",
              password,
            });
          if (prior) await tx.delete(session).where(eq(session.userId, userId));
          const [created] = await tx
            .insert(seller)
            .values({
              ownerUserId: userId,
              displayName: input.displayName,
              contactEmail: input.contactEmail ?? email,
              country: input.country,
              currency: input.currency,
            })
            .returning({ id: seller.id });
          if (!created) throw new Error("seller insert returned nothing");
          return { outcome: "created" as const, userId, sellerId: created.id };
        });
      } catch (error) {
        if (uniqueConflict(error)) {
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
        .select({ userId: user.id })
        .from(user)
        .innerJoin(seller, eq(seller.ownerUserId, user.id))
        .where(eq(user.email, email.trim().toLowerCase()));
      if (!owner) return "not_owner";
      const hashed = await hash(password);
      return transaction(db, async (tx) => {
        const [current] = await tx
          .select()
          .from(seller)
          .where(eq(seller.ownerUserId, owner.userId))
          .for("update");
        if (!current) return "not_owner";
        await tx
          .update(account)
          .set({ password: hashed })
          .where(
            and(
              eq(account.userId, owner.userId),
              eq(account.providerId, "credential"),
            ),
          );
        await tx.delete(session).where(eq(session.userId, owner.userId));
        return "reset";
      });
    },
  };
}
