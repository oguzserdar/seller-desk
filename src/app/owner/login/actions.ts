"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/server/auth/auth";
import { actionClient } from "@/server/actions/safe-action";
import { DomainError } from "@/server/domain/errors";
import { clientKey, requireUsage } from "@/server/domain/usage";
import { findSellerForUser } from "@/server/domain/seller";

const SignInInput = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) }).strict();

export const signInOwner = actionClient.inputSchema(SignInInput).action(async ({ parsedInput }) => {
  const requestHeaders = await headers();
  const email = parsedInput.email.trim().toLowerCase();
  await requireUsage("owner_sign_in_client", clientKey(requestHeaders), 600, 20, "Too many sign-in attempts from here.");
  await requireUsage("owner_sign_in_email", email, 600, 8, "Too many sign-in attempts for this email.");
  try {
    const result = await getAuth().api.signInEmail({ body: { email, password: parsedInput.password }, headers: requestHeaders });
    const owned = await findSellerForUser(result.user.id);
    if (!owned) {
      await getAuth().api.signOut({ headers: requestHeaders });
      throw new DomainError("unauthorized", "That email or password is not correct.");
    }
    return { ok: true as const };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("unauthorized", "That email or password is not correct.");
  }
});

export const signOutOwner = actionClient.action(async () => {
  await getAuth().api.signOut({ headers: await headers() });
  return { ok: true as const };
});
