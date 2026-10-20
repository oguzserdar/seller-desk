import { auditEvent, conversation } from "@/server/db/sqlite/schema";
import type { ConversationControl } from "@/server/domain/conversation-control";
import { conflict, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { D1Db } from "./client";
import { conversationControl } from "./conversation-read";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

/** Takeover and handback revoke old claims in the same native D1 commit. */
export function createD1ConversationControl(db: D1Db) {
  return {
    async changeConversationHandler(
      owner: OwnerPrincipal,
      input: {
        id: string;
        expectedRevision: number;
        handler: "assistant" | "seller";
      },
    ): Promise<ConversationControl> {
      z.uuid().parse(input.id);
      z.number().int().positive().parse(input.expectedRevision);
      z.enum(["assistant", "seller"]).parse(input.handler);
      const [current] = await db
        .select()
        .from(conversation)
        .where(
          and(
            eq(conversation.id, input.id),
            eq(conversation.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!current) throw notFound("conversation");
      if (current.controlRevision !== input.expectedRevision)
        throw conflict(
          "Conversation ownership changed. Reload before switching control.",
        );
      if (current.handler === input.handler)
        return conversationControl(current);
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:control`,
            sql`${ownerScope(owner)} and exists(select 1 from conversation where id=${input.id} and seller_id=${owner.sellerId} and control_revision=${input.expectedRevision} and handler=${current.handler})`,
          ),
          db
            .update(conversation)
            .set({
              handler: input.handler,
              controlRevision: current.controlRevision + 1,
              activeTurnId: null,
              activeTurnExpiresAt: null,
            })
            .where(eq(conversation.id, current.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation:
                input.handler === "seller"
                  ? "conversation.takeover"
                  : "conversation.handback",
              targetType: "conversation",
              targetId: current.id,
              outcome: "ok",
              details: { revision: current.controlRevision + 1 },
            }),
          clearBatchGuards(db, execution),
        ]);
        return conversationControl(rows[0]!);
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "Conversation ownership changed. Reload before switching control.",
          );
        throw error;
      }
    },
  };
}
