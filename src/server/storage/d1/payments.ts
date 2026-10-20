import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  inventory,
  paymentAttempt,
  quote,
  reservation,
} from "@/server/db/sqlite/schema";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { PaymentStorage } from "../payments";
import type { D1Db } from "./client";
import {
  assertD1BuyerScope,
  batchGuard,
  buyerScope,
  clearBatchGuards,
  isBatchGuardFailure,
} from "./guards";
import { recordD1PaidOrder } from "./paid";
import { createD1PaymentReads } from "./payment-read";

/** Complete native D1 payment commands; every compound transition is a guarded batch. */
export function createD1PaymentStorage(db: D1Db): PaymentStorage {
  return {
    ...createD1PaymentReads(db),
    async acquireLease(id, states) {
      const [row] = await db
        .update(paymentAttempt)
        .set({
          leaseOwner: crypto.randomUUID(),
          leaseExpiresAt: sql`${nowMilliseconds}+30000`,
          fence: sql`${paymentAttempt.fence}+1`,
        })
        .where(
          and(
            eq(paymentAttempt.id, id),
            inArray(paymentAttempt.state, states),
            or(
              isNull(paymentAttempt.leaseExpiresAt),
              lt(paymentAttempt.leaseExpiresAt, nowMilliseconds),
            ),
          ),
        )
        .returning();
      return row ?? null;
    },
    async fencedPatch(attempt, value) {
      return (
        (
          await db
            .update(paymentAttempt)
            .set(value)
            .where(
              and(
                eq(paymentAttempt.id, attempt.id),
                eq(paymentAttempt.fence, attempt.fence),
              ),
            )
            .returning({ id: paymentAttempt.id })
        ).length > 0
      );
    },
    async releaseLease(attempt) {
      await db
        .update(paymentAttempt)
        .set({ leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            eq(paymentAttempt.id, attempt.id),
            eq(paymentAttempt.fence, attempt.fence),
          ),
        );
    },
    async closeAttempt(attempt, state, reason, quoteStatus) {
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:close`,
            sql`exists(select 1 from payment_attempt where id=${attempt.id} and fence=${attempt.fence} and state<>'paid')`,
          ),
          db
            .update(inventory)
            .set({
              held: sql`${inventory.held}-(select coalesce(sum(r.quantity),0) from reservation r where r.quote_id=${attempt.quoteId} and r.state='held' and r.offer_id=inventory.offer_id)`,
            })
            .where(
              sql`exists(select 1 from reservation r where r.quote_id=${attempt.quoteId} and r.state='held' and r.offer_id=inventory.offer_id)`,
            ),
          db
            .update(reservation)
            .set({ state: "released" })
            .where(
              and(
                eq(reservation.quoteId, attempt.quoteId),
                eq(reservation.state, "held"),
              ),
            ),
          db
            .update(quote)
            .set({ status: quoteStatus })
            .where(eq(quote.id, attempt.quoteId)),
          db
            .update(paymentAttempt)
            .set({
              state,
              lastError: reason,
              nextCheckAt: null,
              uncertainSince: null,
            })
            .where(eq(paymentAttempt.id, attempt.id)),
          db
            .insert(auditEvent)
            .values({
              actor: "system",
              operation: `payment.${state}`,
              targetType: "payment_attempt",
              targetId: attempt.id,
              outcome: "ok",
              details: { reason },
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (!isBatchGuardFailure(error)) throw error;
      }
    },
    async dispatchCapture(attempt, value, assistant, signal) {
      signal?.throwIfAborted();
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:dispatch`,
            sql`exists(select 1 from payment_attempt where id=${attempt.id} and fence=${attempt.fence}) and ${assistant ? buyerScope(assistant) : sql`1`}`,
          ),
          db
            .update(paymentAttempt)
            .set(value)
            .where(eq(paymentAttempt.id, attempt.id)),
          clearBatchGuards(db, execution),
        ]);
        return true;
      } catch (error) {
        if (!isBatchGuardFailure(error)) throw error;
        if (assistant) await assertD1BuyerScope(db, assistant);
        return false;
      }
    },
    async holdForReview(attempt, reason, evidence) {
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:review`,
            sql`exists(select 1 from payment_attempt where id=${attempt.id} and fence=${attempt.fence})`,
          ),
          db
            .update(paymentAttempt)
            .set({
              state: "verification_pending",
              evidence: evidence ?? attempt.evidence,
              lastError: `evidence_mismatch:${reason}`,
              nextCheckAt: null,
            })
            .where(eq(paymentAttempt.id, attempt.id)),
          db
            .insert(auditEvent)
            .values({
              actor: "system",
              operation: "payment.evidence_mismatch",
              targetType: "payment_attempt",
              targetId: attempt.id,
              outcome: "denied",
              details: { failed: reason },
            }),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (!isBatchGuardFailure(error)) throw error;
      }
    },
    recordPaidOrder: (input) => recordD1PaidOrder(db, input),
  };
}
