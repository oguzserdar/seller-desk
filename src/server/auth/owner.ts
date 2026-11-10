/**
 * Establishes the owner principal from the Better Auth session cookie.
 * The session must belong to the user recorded as this installation's owner;
 * any other signed-in user (there should be none) is treated as signed out.
 */
import { DomainError } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { findSellerForUser, getSeller, type SellerRow } from "@/server/domain/seller";
import { getAuth } from "./auth";
import { hasViewerPass } from "./viewer-pass";

/** Current account identity and its verified shop ownership. */
export type OwnerContext = {
  owner: OwnerPrincipal;
  seller: SellerRow;
  email: string;
  name: string;
  /** A visitor looking around a public demo's desk. They read as the owner would and can change nothing. */
  viewer: boolean;
};

/** What a visitor is told when they try to change something on a public demo's desk. */
export const VIEWER_REFUSAL = "This is the public demo desk. You can look at everything; changing things needs the owner's sign-in.";

/** Resolves the current account and proves it owns this installation's shop. */
export async function readOwner(headers: Headers): Promise<OwnerContext | null> {
  const result = await getAuth().api.getSession({ headers });
  if (result) {
    const sellerRow = await findSellerForUser(result.user.id);
    if (!sellerRow) return null;
    return {
      owner: { kind: "owner", userId: result.user.id, sellerId: sellerRow.id },
      seller: sellerRow,
      email: result.user.email,
      name: result.user.name,
      viewer: false,
    };
  }
  // No owner session: a public demo lets a visitor with a pass read the desk.
  if (!(await hasViewerPass(headers.get("cookie")))) return null;
  const shop = await getSeller();
  if (!shop?.ownerUserId) return null;
  return {
    owner: { kind: "owner", userId: shop.ownerUserId, sellerId: shop.id },
    seller: shop,
    email: "",
    name: "Demo visitor",
    viewer: true,
  };
}

/** Refuses a missing session or an account that does not own the current shop. */
export async function requireOwner(headers: Headers): Promise<OwnerContext> {
  const context = await readOwner(headers);
  if (!context) throw new DomainError("unauthorized", "Sign in as the shop owner to continue.", ["sign_in"]);
  return context;
}

/** For anything that changes the shop or spends its AI budget: the signed-in owner, never a demo visitor. */
export async function requireOwnerWrite(headers: Headers): Promise<OwnerContext> {
  const context = await requireOwner(headers);
  if (context.viewer) throw new DomainError("unauthorized", VIEWER_REFUSAL, ["sign_in"]);
  return context;
}
