import { getDb, type Queryable } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import { getRequestScope } from "@/server/request-scope";
import { assertD1BuyerScope } from "@/server/storage/d1/guards";
import { and, eq, sql } from "drizzle-orm";
import type { BuyerPrincipal } from "./principal";

/** A revoked execution must not be retried as a fresh assistant action. */
export class AssistantTurnEnded extends Error {
  constructor() {
    super("The assistant no longer controls this conversation.");
    this.name = "AssistantTurnEnded";
  }
}

/**
 * Verifies an assistant claim against its authenticated buyer and shop. Manual
 * buyer operations have no assistant claim. Mutations hold this row in their
 * existing transaction, so takeover and the write have one definitive order.
 */
export async function assertAssistantTurn(
  buyer: BuyerPrincipal,
  db?: Queryable,
  lock = false,
): Promise<void> {
  if (!buyer.assistantTurn) return;
  const native = getRequestScope()?.d1;
  if (!db && native) return assertD1BuyerScope(native, buyer);
  db ??= getDb();
  const query = db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, buyer.assistantTurn.conversationId),
        eq(conversation.sellerId, buyer.sellerId),
        eq(conversation.buyerSessionId, buyer.buyerSessionId),
        eq(conversation.handler, "assistant"),
        eq(conversation.activeTurnId, buyer.assistantTurn.id),
        sql`${conversation.activeTurnExpiresAt} > now()`,
      ),
    );
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new AssistantTurnEnded();
}
