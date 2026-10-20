/**
 * Establishes the owner principal from the Better Auth session cookie.
 * The session must belong to the user recorded as this installation's owner;
 * any other signed-in user (there should be none) is treated as signed out.
 */
import { DomainError } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { findSellerForUser, type SellerRow } from "@/server/domain/seller";
import { getAuth } from "./auth";

/** Current account identity and its verified shop ownership. */
export type OwnerContext = { owner: OwnerPrincipal; seller: SellerRow; email: string; name: string };

/** Resolves the current account and proves it owns this installation's shop. */
export async function readOwner(headers: Headers): Promise<OwnerContext | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const sellerRow = await findSellerForUser(result.user.id);
  if (!sellerRow) return null;
  return {
    owner: { kind: "owner", userId: result.user.id, sellerId: sellerRow.id },
    seller: sellerRow,
    email: result.user.email,
    name: result.user.name,
  };
}

/** Refuses a missing session or an account that does not own the current shop. */
export async function requireOwner(headers: Headers): Promise<OwnerContext> {
  const context = await readOwner(headers);
  if (!context) throw new DomainError("unauthorized", "Sign in as the shop owner to continue.", ["sign_in"]);
  return context;
}
