import type {
  OwnerHistory,
  OwnerTurn,
  SavedDecision,
} from "@/server/ai/owner-conversation";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  ownerConversation,
  ownerMessage,
  ownerProposal,
} from "@/server/db/sqlite/schema";
import { conflict } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { isToolUIPart, type UIMessage } from "ai";
import { and, desc, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
import { messageWrites } from "./message-writes";

function scope(owner: OwnerPrincipal) {
  return and(
    eq(ownerConversation.sellerId, owner.sellerId),
    eq(ownerConversation.ownerId, owner.userId),
    ownerScope(owner),
  );
}

/** Private native owner conversation storage, including durable approval-state hydration. */
export function createD1OwnerConversationStorage(db: D1Db) {
  return {
    async loadOwnerHistory(owner: OwnerPrincipal): Promise<OwnerHistory> {
      const [conversations, messages] = await db.batch([
        db.select().from(ownerConversation).where(scope(owner)),
        db
          .select()
          .from(ownerMessage)
          .where(
            sql`exists(select 1 from owner_conversation c where c.id=${ownerMessage.conversationId} and c.owner_id=${owner.userId} and c.seller_id=${owner.sellerId}) and ${ownerScope(owner)}`,
          )
          .orderBy(desc(ownerMessage.sequence))
          .limit(40),
      ]);
      const row = conversations[0];
      if (!row)
        return {
          messages: [],
          busyUntil: null,
          interrupted: false,
          decisions: {},
        };
      const history: UIMessage[] = messages
        .reverse()
        .map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts as UIMessage["parts"],
        }));
      const ids = history.flatMap((m) =>
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
                sql`${ownerProposal.id} in (select value from json_each(${JSON.stringify(ids)}))`,
                ownerScope(owner),
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
        messages: history,
        busyUntil,
        interrupted: !busyUntil && history.at(-1)?.role === "user",
        decisions,
      };
    },
    async beginOwnerTurn(
      owner: OwnerPrincipal,
      message: UIMessage,
    ): Promise<OwnerTurn> {
      const [current] = await db
        .select()
        .from(ownerConversation)
        .where(scope(owner));
      const conversationId = current?.id ?? crypto.randomUUID(),
        id = crypto.randomUUID(),
        execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:owner-turn`,
            sql`${ownerScope(owner)} and ${current ? sql`exists(select 1 from owner_conversation where id=${conversationId} and seller_id=${owner.sellerId} and owner_id=${owner.userId} and (active_turn_id is null or active_turn_expires_at<=${nowMilliseconds}))` : sql`not exists(select 1 from owner_conversation where seller_id=${owner.sellerId} and owner_id=${owner.userId})`}
            and not exists(select 1 from owner_message where conversation_id=${conversationId} and id=${message.id})`,
          ),
          ...(current
            ? []
            : [
                db
                  .insert(ownerConversation)
                  .values({
                    id: conversationId,
                    sellerId: owner.sellerId,
                    ownerId: owner.userId,
                  }),
              ]),
          db
            .update(ownerConversation)
            .set({
              activeTurnId: id,
              activeTurnExpiresAt: sql`${nowMilliseconds}+120000`,
            })
            .where(eq(ownerConversation.id, conversationId)),
          ...messageWrites(
            db,
            conversationId,
            [{ ...message, role: "user" }],
            true,
          ),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This message was already received or the assistant is still answering. Refresh your conversation.",
          );
        throw error;
      }
      return { conversationId, id, owner };
    },
    async completeOwnerTurn(
      claim: OwnerTurn,
      messages: UIMessage[],
    ): Promise<void> {
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:complete`,
            sql`${ownerScope(claim.owner)} and exists(select 1 from owner_conversation where id=${claim.conversationId} and seller_id=${claim.owner.sellerId} and owner_id=${claim.owner.userId} and active_turn_id=${claim.id} and active_turn_expires_at>${nowMilliseconds})`,
          ),
          db
            .update(ownerConversation)
            .set({ activeTurnId: null, activeTurnExpiresAt: null })
            .where(eq(ownerConversation.id, claim.conversationId)),
          ...messageWrites(
            db,
            claim.conversationId,
            messages.filter((m) => m.role === "assistant"),
            true,
          ),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This answer expired. Refresh your conversation before asking again.",
          );
        throw error;
      }
    },
    async releaseOwnerTurn(claim: OwnerTurn): Promise<void> {
      await db
        .update(ownerConversation)
        .set({ activeTurnId: null, activeTurnExpiresAt: null })
        .where(
          and(
            scope(claim.owner),
            eq(ownerConversation.id, claim.conversationId),
            eq(ownerConversation.activeTurnId, claim.id),
          ),
        );
    },
  };
}
