import "server-only";
import { headers } from "next/headers";
import { createSafeActionClient } from "next-safe-action";
import { requireOwnerWrite } from "@/server/auth/owner";
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
  // Every owner action changes something, so a demo visitor is refused here, in one place.
  const context = await requireOwnerWrite(await headers());
  return next({ ctx: context });
});
