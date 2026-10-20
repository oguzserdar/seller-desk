import { nowMilliseconds } from "@/server/db/sqlite/columns";
import { operationKey } from "@/server/db/sqlite/operations";
import { seller } from "@/server/db/sqlite/shop";
import { AssistantTurnEnded } from "@/server/domain/assistant-turn";
import { notFound } from "@/server/domain/errors";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { D1Db } from "./client";

/**
 * A fresh invocation key makes a failed precondition abort the whole D1 batch.
 * Guards are removed in that same batch and cannot authorize a later replay.
 * This builds a statement only; it never executes or emulates a transaction.
 */
export function batchGuard(db: D1Db, executionId: string, predicate: SQL) {
  return db.insert(operationKey).values({
    scope: "d1-batch-guard",
    key: executionId,
    payloadHash: "",
    state: sql`case when (${predicate}) then 'in_progress' else 'guard_failed' end`,
  });
}

/** Removes only this command's temporary guards before its atomic commit. */
export function clearBatchGuards(db: D1Db, executionId: string) {
  return db
    .delete(operationKey)
    .where(
      and(
        eq(operationKey.scope, "d1-batch-guard"),
        sql`${operationKey.key} like ${`${executionId}:%`}`,
      ),
    );
}

/** Live buyer and optional assistant execution scope, rechecked inside the write batch. */
export function buyerScope(buyer: BuyerPrincipal): SQL {
  const session = sql`exists(select 1 from buyer_session where id=${buyer.buyerSessionId} and seller_id=${buyer.sellerId} and revoked_at is null and expires_at > ${nowMilliseconds})`;
  if (!buyer.assistantTurn) return session;
  const claim = buyer.assistantTurn;
  return sql`${session} and exists(select 1 from conversation where id=${claim.conversationId} and seller_id=${buyer.sellerId} and buyer_session_id=${buyer.buyerSessionId} and handler='assistant' and active_turn_id=${claim.id} and active_turn_expires_at > ${nowMilliseconds})`;
}

/** Trusted owner must still own the installation when its batch commits. */
export function ownerScope(owner: OwnerPrincipal): SQL {
  return sql`exists(select 1 from seller where id=${owner.sellerId} and owner_user_id=${owner.userId})`;
}

/** Only our deliberately failing CHECK is retryable as an optimistic conflict. */
export { isBatchGuardFailure } from "./errors";

/** Rechecks revocable buyer authority when an optimistic command loses its guard. */
export async function assertD1BuyerScope(
  db: D1Db,
  buyer: BuyerPrincipal,
): Promise<void> {
  const [row] = await db
    .select({ id: seller.id })
    .from(seller)
    .where(and(eq(seller.id, buyer.sellerId), buyerScope(buyer)));
  if (row) return;
  if (buyer.assistantTurn) throw new AssistantTurnEnded();
  throw notFound("current customer conversation");
}
