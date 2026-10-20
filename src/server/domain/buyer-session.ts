import { getStorage } from "@/server/storage";
/**
 * Buyer scope. A buyer holds a random bearer capability (kept in the tab's
 * sessionStorage); the server stores only its SHA-256. It grants access to that
 * buyer's own conversation, quotes and orders, and never to owner operations.
 */
import { randomToken, sha256Hex } from "@/server/crypto";
import { getDb, transaction } from "@/server/db/client";
import {
  buyerCapability,
  buyerHandoff,
  buyerSession,
} from "@/server/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";
import { DomainError } from "./errors";
import type { BuyerPrincipal } from "./principal";
import { getSeller } from "./seller";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type IssuedCapability = {
  token: string;
  buyerSessionId: string;
  expiresAt: string;
};

export async function startBuyerSession(
  entry: "page" | "widget",
): Promise<IssuedCapability> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.sessions.startBuyerSession(entry);

  const sellerRow = await getSeller();
  if (!sellerRow)
    throw new DomainError("unavailable", "This shop is not set up yet.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = await transaction(getDb(), async (tx) => {
    const [created] = await tx
      .insert(buyerSession)
      .values({ sellerId: sellerRow.id, entry, expiresAt })
      .returning({ id: buyerSession.id });
    if (!created) throw new Error("buyer session insert returned nothing");
    await tx.insert(buyerCapability).values({
      buyerSessionId: created.id,
      capabilityHash: sha256Hex(token),
      issuedVia: "start",
      expiresAt,
    });
    return created.id;
  });
  return {
    token,
    buyerSessionId: sessionId,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Resolves a presented capability. Missing, unknown, revoked and expired all look the same. */
export async function resolveBuyer(
  token: string | null | undefined,
): Promise<BuyerPrincipal> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.sessions.resolveBuyer(token);

  if (!token || !TOKEN_PATTERN.test(token)) throw buyerSessionEnded();
  const now = new Date();
  const [row] = await getDb()
    .select({
      buyerSessionId: buyerSession.id,
      sellerId: buyerSession.sellerId,
    })
    .from(buyerCapability)
    .innerJoin(
      buyerSession,
      eq(buyerSession.id, buyerCapability.buyerSessionId),
    )
    .where(
      and(
        eq(buyerCapability.capabilityHash, sha256Hex(token)),
        isNull(buyerCapability.revokedAt),
        gt(buyerCapability.expiresAt, now),
        isNull(buyerSession.revokedAt),
        gt(buyerSession.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) throw buyerSessionEnded();
  return {
    kind: "buyer",
    buyerSessionId: row.buyerSessionId,
    sellerId: row.sellerId,
  };
}

function buyerSessionEnded(): DomainError {
  return new DomainError(
    "unauthorized",
    "Your chat session has ended. Start a new chat to continue.",
    ["start_session"],
  );
}

/** Ends the buyer's session on every device and tab ("Forget this chat"). */
export async function endBuyerSession(buyer: BuyerPrincipal): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.sessions.endBuyerSession(buyer);

  await getDb()
    .update(buyerSession)
    .set({ revokedAt: new Date() })
    .where(eq(buyerSession.id, buyer.buyerSessionId));
}

/**
 * One-time code that moves this buyer scope from the widget iframe to the
 * top-level checkout page. It travels in the URL fragment and is exchanged by POST.
 */
export async function createHandoff(
  buyer: BuyerPrincipal,
  quoteId: string | null,
): Promise<{ code: string }> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.sessions.createHandoff(buyer, quoteId);

  const code = randomToken(24);
  await getDb()
    .insert(buyerHandoff)
    .values({
      buyerSessionId: buyer.buyerSessionId,
      codeHash: sha256Hex(code),
      quoteId,
      expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
    });
  return { code };
}

export async function exchangeHandoff(
  code: string,
): Promise<IssuedCapability & { quoteId: string | null }> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.sessions.exchangeHandoff(code);

  if (!TOKEN_PATTERN.test(code)) throw handoffExpired();
  const token = randomToken();
  return transaction(getDb(), async (tx) => {
    const [handoff] = await tx
      .select()
      .from(buyerHandoff)
      .where(eq(buyerHandoff.codeHash, sha256Hex(code)))
      .for("update");
    if (!handoff || handoff.usedAt || handoff.expiresAt <= new Date())
      throw handoffExpired();
    const [session] = await tx
      .select()
      .from(buyerSession)
      .where(eq(buyerSession.id, handoff.buyerSessionId));
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw handoffExpired();
    await tx
      .update(buyerHandoff)
      .set({ usedAt: new Date() })
      .where(eq(buyerHandoff.id, handoff.id));
    await tx.insert(buyerCapability).values({
      buyerSessionId: session.id,
      capabilityHash: sha256Hex(token),
      issuedVia: "handoff",
      expiresAt: session.expiresAt,
    });
    return {
      token,
      buyerSessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      quoteId: handoff.quoteId,
    };
  });
}

function handoffExpired(): DomainError {
  return new DomainError(
    "unauthorized",
    "This checkout link has expired or was already used. Go back to the chat and choose Continue to checkout again.",
    ["start_session"],
  );
}
