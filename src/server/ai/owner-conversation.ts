import { getStorage } from "@/server/storage";
/** Durable owner chat, scoped from the authenticated owner rather than browser history. */
import { getDb, transaction } from "@/server/db/client";
import {
  ownerConversation,
  ownerMessage,
  ownerProposal,
} from "@/server/db/schema";
import type { StoredMessagePart } from "@/server/db/types";
import { conflict } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { isToolUIPart, type UIMessage } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

/** Browser-safe current decision; absence means the suggestion still awaits approval. */
export type SavedDecision = {
  state: "executed" | "rejected" | "expired" | "failed" | "unconfirmed";
  message: string;
};
/** Recent history for rendering and model context. All messages remain stored. */
export type OwnerHistory = {
  messages: UIMessage[];
  busyUntil: string | null;
  interrupted: boolean;
  decisions: Record<string, SavedDecision>;
};
/** Only the holder of this expiring claim may finish the turn. */
export type OwnerTurn = {
  conversationId: string;
  id: string;
  owner: OwnerPrincipal;
};

function scope(owner: OwnerPrincipal) {
  return and(
    eq(ownerConversation.sellerId, owner.sellerId),
    eq(ownerConversation.ownerId, owner.userId),
  );
}

/** Reads without creating records; hydrates proposal decisions from current scoped records. */
export async function loadOwnerHistory(
  owner: OwnerPrincipal,
): Promise<OwnerHistory> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.ownerChat.loadOwnerHistory(owner);

  const db = getDb();
  const [row] = await db.select().from(ownerConversation).where(scope(owner));
  if (!row)
    return { messages: [], busyUntil: null, interrupted: false, decisions: {} };
  const rows = await db
    .select()
    .from(ownerMessage)
    .where(eq(ownerMessage.conversationId, row.id))
    .orderBy(desc(ownerMessage.sequence))
    .limit(40);
  const messages: UIMessage[] = rows
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts as UIMessage["parts"],
    }));
  const ids = messages.flatMap((m) =>
    m.parts.flatMap((p) => {
      if (
        !isToolUIPart(p) ||
        p.type !== "tool-propose_action" ||
        p.state !== "output-available"
      )
        return [];
      const output = p.output as { proposalId?: string } | null;
      return output?.proposalId ? [output.proposalId] : [];
    }),
  );
  const proposals = ids.length
    ? await db
        .select()
        .from(ownerProposal)
        .where(
          and(
            eq(ownerProposal.sellerId, owner.sellerId),
            inArray(ownerProposal.id, ids),
          ),
        )
    : [];
  const decisions: Record<string, SavedDecision> = {};
  for (const id of ids) {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal)
      decisions[id] = {
        state: "unconfirmed",
        message: "This suggestion is no longer available. Ask again.",
      };
    else if (
      proposal.state === "pending" &&
      proposal.expiresAt.getTime() > Date.now()
    )
      continue;
    else if (proposal.state === "pending" || proposal.state === "expired")
      decisions[id] = {
        state: "expired",
        message: "This suggestion expired. Ask again for a fresh one.",
      };
    else if (proposal.state === "rejected")
      decisions[id] = { state: "rejected", message: "Left as it is." };
    else if (!proposal.result)
      decisions[id] = {
        state: "unconfirmed",
        message:
          "Approval was recorded. Check the order for its current outcome.",
      };
    else
      decisions[id] = {
        state: proposal.state,
        message: proposal.result.message,
      };
  }
  const busyUntil =
    row.activeTurnId &&
    row.activeTurnExpiresAt &&
    row.activeTurnExpiresAt.getTime() > Date.now()
      ? row.activeTurnExpiresAt.toISOString()
      : null;
  return {
    messages,
    busyUntil,
    interrupted: !busyUntil && messages.at(-1)?.role === "user",
    decisions,
  };
}

/** Claims one turn and saves its input atomically. Duplicate submissions cannot start a second turn. */
export async function beginOwnerTurn(
  owner: OwnerPrincipal,
  message: UIMessage,
): Promise<OwnerTurn> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.ownerChat.beginOwnerTurn(owner, message);

  return transaction(getDb(), async (tx) => {
    await tx
      .insert(ownerConversation)
      .values({ sellerId: owner.sellerId, ownerId: owner.userId })
      .onConflictDoNothing();
    const id = crypto.randomUUID();
    const [row] = await tx
      .update(ownerConversation)
      .set({
        activeTurnId: id,
        activeTurnExpiresAt: sql`now() + interval '2 minutes'`,
      })
      .where(
        and(
          scope(owner),
          sql`(${ownerConversation.activeTurnId} is null or ${ownerConversation.activeTurnExpiresAt} <= now())`,
        ),
      )
      .returning();
    if (!row)
      throw conflict(
        "The assistant is still answering. Wait a moment, then refresh your conversation.",
      );
    const saved = await tx
      .insert(ownerMessage)
      .values({
        conversationId: row.id,
        id: message.id,
        role: "user",
        parts: message.parts as StoredMessagePart[],
      })
      .onConflictDoNothing()
      .returning({ id: ownerMessage.id });
    if (!saved.length)
      throw conflict(
        "This message was already received. Refresh to see its saved conversation.",
      );
    return { conversationId: row.id, id, owner };
  });
}

/** Stores only completed assistant messages and releases the exact live claim in one transaction. */
export async function completeOwnerTurn(
  claim: OwnerTurn,
  messages: UIMessage[],
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.ownerChat.completeOwnerTurn(claim, messages);

  await transaction(getDb(), async (tx) => {
    const rows = await tx
      .update(ownerConversation)
      .set({ activeTurnId: null, activeTurnExpiresAt: null })
      .where(
        and(
          scope(claim.owner),
          eq(ownerConversation.id, claim.conversationId),
          eq(ownerConversation.activeTurnId, claim.id),
          sql`${ownerConversation.activeTurnExpiresAt} > now()`,
        ),
      )
      .returning({ id: ownerConversation.id });
    if (!rows.length)
      throw conflict(
        "This answer expired. Refresh your conversation before asking again.",
      );
    const replies = messages
      .filter((m) => m.role === "assistant")
      .map((m) => ({
        conversationId: claim.conversationId,
        id: m.id,
        role: "assistant" as const,
        parts: m.parts as StoredMessagePart[],
      }));
    if (replies.length)
      await tx.insert(ownerMessage).values(replies).onConflictDoNothing();
  });
}

/** Releases failed or stopped turns without inventing a completed answer. */
/**
 * Ends the owner's running answer when they press Stop, so the desk chat is
 * free at once instead of after the lease; the old worker can no longer commit.
 */
export async function stopOwnerTurn(owner: OwnerPrincipal): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.ownerChat.stopOwnerTurn(owner);

  await getDb()
    .update(ownerConversation)
    .set({ activeTurnId: null, activeTurnExpiresAt: null })
    .where(scope(owner));
}

export async function releaseOwnerTurn(claim: OwnerTurn): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.ownerChat.releaseOwnerTurn(claim);

  await getDb()
    .update(ownerConversation)
    .set({ activeTurnId: null, activeTurnExpiresAt: null })
    .where(
      and(
        scope(claim.owner),
        eq(ownerConversation.id, claim.conversationId),
        eq(ownerConversation.activeTurnId, claim.id),
      ),
    );
}
