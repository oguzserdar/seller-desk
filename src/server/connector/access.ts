/**
 * Which AI apps the owner allowed to use the desk, and removing one. Goes through Better Auth's own
 * database adapter, so it behaves the same on PostgreSQL and D1.
 *
 * Removing an app deletes its approval and every refresh and access token it holds for this owner.
 * Deleting the approval alone would leave a refresh token working for weeks, and access tokens are
 * signed tokens that verify on their own, so the connector also calls {@link stillAllowed} on every
 * request: a removed app stops on its next call.
 */
import { getAuth } from "@/server/auth/auth";

/** An AI app the owner allowed, for the list in Setup. */
export type AllowedApp = { consentId: string; name: string; site: string | null; allowedAt: string };

type ConsentRow = { id: string; clientId: string; userId: string; createdAt: Date };
type ClientRow = { clientId: string; name?: string | null; uri?: string | null };

const adapter = async () => (await getAuth().$context).adapter;

/**
 * Lists the AI apps this owner allowed, newest first, with the name and site each app registered.
 *
 * @param userId - The owner's user id
 * @returns The allowed apps; an app that registered no name shows as "An AI app"
 */
export async function allowedApps(userId: string): Promise<AllowedApp[]> {
  const db = await adapter();
  const consents = await db.findMany<ConsentRow>({ model: "oauthConsent", where: [{ field: "userId", value: userId }] });
  const clients = consents.length
    ? await db.findMany<ClientRow>({ model: "oauthClient", where: [{ field: "clientId", operator: "in", value: consents.map((c) => c.clientId) }] })
    : [];
  return consents
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((consent) => {
      const client = clients.find((c) => c.clientId === consent.clientId);
      return { consentId: consent.id, name: client?.name?.trim() || "An AI app", site: client?.uri ?? null, allowedAt: consent.createdAt.toISOString() };
    });
}

/**
 * Removes one allowed app for this owner only, with its tokens.
 *
 * @param userId - The owner's user id
 * @param consentId - The approval to remove
 * @returns False when the approval is not this owner's or is already gone
 */
export async function removeApp(userId: string, consentId: string): Promise<boolean> {
  const db = await adapter();
  const consent = await db.findOne<ConsentRow>({ model: "oauthConsent", where: [{ field: "id", value: consentId }, { field: "userId", value: userId }] });
  if (!consent) return false;
  const mine = [{ field: "userId", value: userId }, { field: "clientId", value: consent.clientId }];
  await db.transaction(async (tx) => {
    await tx.deleteMany({ model: "oauthRefreshToken", where: mine });
    await tx.deleteMany({ model: "oauthAccessToken", where: mine });
    await tx.delete({ model: "oauthConsent", where: [{ field: "id", value: consentId }] });
  });
  return true;
}

/**
 * True while the owner still allows this app; the connector checks it on every call.
 *
 * @param userId - The owner's user id, from the access token's subject
 * @param clientId - The AI app's client id, from the access token's authorized party
 */
export async function stillAllowed(userId: string, clientId: string): Promise<boolean> {
  const db = await adapter();
  return !!(await db.findOne({ model: "oauthConsent", where: [{ field: "userId", value: userId }, { field: "clientId", value: clientId }] }));
}
