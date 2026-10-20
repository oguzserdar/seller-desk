import { completeResume } from "@/server/domain/seller-questions";
import { getStorage } from "@/server/storage";
/** One durable execution slot shared by foreground and resumed buyer turns. */
import { getDb, transaction } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import type { BuyerPrincipal } from "@/server/domain/principal";
import type { UIMessage } from "ai";
import { and, eq, sql } from "drizzle-orm";
import { saveMessages } from "./conversation";

/** A unique, expiring claim; an old worker cannot release or commit a newer turn. */
export type TurnClaim = { conversationId: string; id: string };

/** Claims only this authenticated buyer's conversation, without holding a connection during inference. */
export async function claimTurn(
  buyer: BuyerPrincipal,
  conversationId: string,
): Promise<TurnClaim | undefined> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.claimTurn(buyer, conversationId);

  const id = crypto.randomUUID();
  const rows = await getDb()
    .update(conversation)
    .set({
      activeTurnId: id,
      activeTurnExpiresAt: sql`now() + interval '2 minutes'`,
    })
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.sellerId, buyer.sellerId),
        eq(conversation.buyerSessionId, buyer.buyerSessionId),
        eq(conversation.handler, "assistant"),
        sql`(${conversation.activeTurnId} is null or ${conversation.activeTurnExpiresAt} <= now())`,
      ),
    )
    .returning({ id: conversation.id });
  return rows.length ? { conversationId, id } : undefined;
}

/** Frees only this claim, including failures and cancelled streams. */
export async function releaseTurn(claim: TurnClaim): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.conversations.releaseTurn(claim);

  await getDb()
    .update(conversation)
    .set({ activeTurnId: null, activeTurnExpiresAt: null })
    .where(
      and(
        eq(conversation.id, claim.conversationId),
        eq(conversation.activeTurnId, claim.id),
      ),
    );
}

/** Commits messages and any related state atomically, only while this worker still owns a live claim. */
export async function completeTurn(
  claim: TurnClaim,
  messages: UIMessage[],
  resume?: import("@/server/storage/d1/conversation").ResumeCompletion,
): Promise<void> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.completeTurn(claim, messages, resume);

  await transaction(getDb(), async (tx) => {
    const rows = await tx
      .update(conversation)
      .set({ activeTurnId: null, activeTurnExpiresAt: null })
      .where(
        and(
          eq(conversation.id, claim.conversationId),
          eq(conversation.handler, "assistant"),
          eq(conversation.activeTurnId, claim.id),
          sql`${conversation.activeTurnExpiresAt} > now()`,
        ),
      )
      .returning({ id: conversation.id });
    if (!rows.length)
      throw new Error("This conversation turn expired or was replaced.");
    if (resume && !(await completeResume(resume, tx)))
      throw new Error("This continuation's claim expired or was replaced.");
    await saveMessages(claim.conversationId, messages, tx);
  });
}
