/**
 * Owner creation and password reset through Better Auth's own internal adapter
 * and password hasher. Operator CLI, fixture installer and the private-token
 * protected first-owner installer share the same atomic empty-shop guard.
 */
import { getDb } from "@/server/db/client";
import { getStorage } from "@/server/storage";
import { createPostgresBootstrap } from "@/server/storage/postgres/bootstrap";

export type BootstrapInput = {
  email: string;
  password: string;
  displayName: string;
  country: string;
  currency: string;
  contactEmail?: string;
};

export type BootstrapResult =
  | { outcome: "created"; userId: string; sellerId: string }
  | { outcome: "exists"; ownerEmail: string };

/** Operator-only creation; the native backend commits the owner and shop together. */
export async function bootstrapOwner(
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const backend = getStorage();
  return backend.kind === "d1"
    ? backend.bootstrap.bootstrapOwner(input)
    : createPostgresBootstrap(getDb()).bootstrapOwner(input);
}
/** Changes the owner's password and revokes all sessions atomically. */
export async function resetOwnerPassword(
  email: string,
  password: string,
): Promise<"reset" | "not_owner"> {
  const backend = getStorage();
  return backend.kind === "d1"
    ? backend.bootstrap.resetOwnerPassword(email, password)
    : createPostgresBootstrap(getDb()).resetOwnerPassword(email, password);
}
