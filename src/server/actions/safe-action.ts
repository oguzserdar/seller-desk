import "server-only";
import { headers } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { requireOwner } from "@/server/auth/owner";
import { DomainError } from "@/server/domain/errors";

/**
 * Server Actions are reachable by direct POST, so every owner action
 * re-establishes the owner from the session cookie inside the action.
 * Domain errors become safe messages; anything else is logged and hidden.
 */
export const actionClient = createSafeActionClient({
  handleServerError(error) {
    if (error instanceof DomainError) return error.message;
    console.error("server action failed", error);
    return "Something went wrong. Try again in a moment.";
  },
});

export const ownerAction = actionClient.use(async ({ next }) => {
  const context = await requireOwner(await headers());
  return next({ ctx: context });
});
