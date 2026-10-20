import { getDb, transaction, type Queryable } from "@/server/db/client";
import { conversation, seller } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, notFound } from "./errors";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

/** Durable, browser-safe ownership state; it grants no permission by itself. */
export type ConversationControl = {
  id: string;
  handler: "assistant" | "seller";
  revision: number;
};

function control(row: typeof conversation.$inferSelect): ConversationControl {
  return { id: row.id, handler: row.handler, revision: row.controlRevision };
}

/** Loads a conversation only after proving owner identity; mutations lock shop then conversation. */
export async function ownerConversation(
  owner: OwnerPrincipal,
  id: string,
  db: Queryable,
  lock: boolean,
) {
  z.uuid().parse(id);
  const shopQuery = db
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  const [shop] = await (lock ? shopQuery.for("update") : shopQuery);
  if (!shop) throw notFound("conversation");
  const query = db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.sellerId, shop.id)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("conversation");
  return row;
}

/** Reads ownership only after proving this owner belongs to the conversation's shop. */
export async function readOwnerConversationControl(
  owner: OwnerPrincipal,
  id: string,
): Promise<ConversationControl> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.readOwnerConversationControl(owner, id);

  return control(await ownerConversation(owner, id, getDb(), false));
}

/** Reads control for this authenticated buyer's own conversation, never another buyer's id. */
export async function readBuyerConversationControl(
  buyer: BuyerPrincipal,
  id: string,
): Promise<ConversationControl> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.readBuyerConversationControl(buyer, id);

  z.uuid().parse(id);
  const [row] = await getDb()
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.id, id),
        eq(conversation.sellerId, buyer.sellerId),
        eq(conversation.buyerSessionId, buyer.buyerSessionId),
      ),
    );
  if (!row) throw notFound("conversation");
  return control(row);
}

/** Changes ownership atomically and revokes old inference claims; runtime interruption must also be enforced. */
export async function changeConversationHandler(
  owner: OwnerPrincipal,
  input: {
    id: string;
    expectedRevision: number;
    handler: "assistant" | "seller";
  },
): Promise<ConversationControl> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.conversations.changeConversationHandler(owner, input);

  z.number().int().positive().parse(input.expectedRevision);
  z.enum(["assistant", "seller"]).parse(input.handler);
  return transaction(getDb(), async (tx) => {
    const current = await ownerConversation(owner, input.id, tx, true);
    if (current.controlRevision !== input.expectedRevision)
      throw conflict(
        "Conversation ownership changed. Reload before switching control.",
      );
    if (current.handler === input.handler) return control(current);
    const [updated] = await tx
      .update(conversation)
      .set({
        handler: input.handler,
        controlRevision: current.controlRevision + 1,
        updatedAt: new Date(),
        activeTurnId: null,
        activeTurnExpiresAt: null,
      })
      .where(
        and(
          eq(conversation.id, current.id),
          eq(conversation.sellerId, owner.sellerId),
          eq(conversation.controlRevision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated)
      throw conflict(
        "Conversation ownership changed. Reload before switching control.",
      );
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation:
        input.handler === "seller"
          ? "conversation.takeover"
          : "conversation.handback",
      targetType: "conversation",
      targetId: current.id,
      outcome: "ok",
      details: { revision: updated.controlRevision },
    });
    return control(updated);
  });
}
