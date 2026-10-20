import { transaction, type Db, type Queryable } from "@/server/db/client";
import { paymentAttempt, quote } from "@/server/db/schema";
import { assertAssistantTurn } from "@/server/domain/assistant-turn";
import { recordAudit } from "@/server/domain/audit";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type {
  PaymentAttemptRow,
  PaymentPatch,
  PaymentStorage,
} from "../payments";
import { recordPostgresPaidOrder, releasePostgresReservations } from "./paid";
import { createPostgresPaymentReads } from "./payment-read";

async function patch(
  q: Queryable,
  attempt: PaymentAttemptRow,
  value: PaymentPatch,
): Promise<boolean> {
  const rows = await q
    .update(paymentAttempt)
    .set(value)
    .where(
      and(
        eq(paymentAttempt.id, attempt.id),
        eq(paymentAttempt.fence, attempt.fence),
      ),
    )
    .returning({ id: paymentAttempt.id });
  return rows.length > 0;
}

/** Complete PostgreSQL payment storage commands, retaining native locks and transactions. */
export function createPostgresPaymentStorage(db: Db): PaymentStorage {
  return {
    ...createPostgresPaymentReads(db),
    async acquireLease(id, states) {
      const [row] = await db
        .update(paymentAttempt)
        .set({
          leaseOwner: `${process.pid}:${crypto.randomUUID()}`,
          leaseExpiresAt: sql`now()+interval '30 seconds'`,
          fence: sql`${paymentAttempt.fence}+1`,
        })
        .where(
          and(
            eq(paymentAttempt.id, id),
            inArray(paymentAttempt.state, states),
            or(
              isNull(paymentAttempt.leaseExpiresAt),
              lt(paymentAttempt.leaseExpiresAt, sql`now()`),
            ),
          ),
        )
        .returning();
      return row ?? null;
    },
    async fencedPatch(attempt, value) {
      return patch(db, attempt, value);
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
      await transaction(db, async (tx) => {
        const rows = await tx
          .update(paymentAttempt)
          .set({
            state,
            lastError: reason,
            nextCheckAt: null,
            uncertainSince: null,
          })
          .where(
            and(
              eq(paymentAttempt.id, attempt.id),
              eq(paymentAttempt.fence, attempt.fence),
              sql`${paymentAttempt.state}<>'paid'`,
            ),
          )
          .returning({ id: paymentAttempt.id });
        if (!rows.length) return;
        await releasePostgresReservations(tx, attempt.quoteId);
        await tx
          .update(quote)
          .set({ status: quoteStatus })
          .where(eq(quote.id, attempt.quoteId));
        await recordAudit(tx, {
          actor: "system",
          operation: `payment.${state}`,
          targetType: "payment_attempt",
          targetId: attempt.id,
          outcome: "ok",
          details: { reason },
        });
      });
    },
    async dispatchCapture(attempt, value, assistant, signal) {
      return transaction(db, async (tx) => {
        if (assistant) await assertAssistantTurn(assistant, tx, true);
        signal?.throwIfAborted();
        return patch(tx, attempt, value);
      });
    },
    async holdForReview(attempt, reason, evidence) {
      await transaction(db, async (tx) => {
        if (
          !(await patch(tx, attempt, {
            state: "verification_pending",
            evidence: evidence ?? attempt.evidence,
            lastError: `evidence_mismatch:${reason}`,
            nextCheckAt: null,
          }))
        )
          return;
        await recordAudit(tx, {
          actor: "system",
          operation: "payment.evidence_mismatch",
          targetType: "payment_attempt",
          targetId: attempt.id,
          outcome: "denied",
          details: { failed: reason },
        });
      });
    },
    recordPaidOrder: (input) => recordPostgresPaidOrder(db, input),
  };
}
