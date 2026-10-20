import type { PaidCommitInput, PaidOutcome } from "../payments";
/**
 * The single transaction that turns verified payment evidence into an order,
 * sold stock and fulfillment obligations. It is idempotent: replays find the
 * existing order through unique constraints and change nothing.
 */
import { type Db, type Tx, transaction } from "@/server/db/client";
import {
  fulfillmentTask,
  inventory,
  job,
  orders,
  paymentAttempt,
  quote,
  reservation,
} from "@/server/db/schema";
import type { OrderSnapshot } from "@/server/db/types";
import { recordAudit } from "@/server/domain/audit";
import { assertQuotePriced } from "@/server/domain/priced-quote";
import { and, eq, sql } from "drizzle-orm";

/** Returns held stock for a quote to the shelf. */
export async function releasePostgresReservations(
  tx: Tx,
  quoteId: string,
): Promise<number> {
  const released = await tx
    .update(reservation)
    .set({ state: "released" })
    .where(and(eq(reservation.quoteId, quoteId), eq(reservation.state, "held")))
    .returning({
      offerId: reservation.offerId,
      quantity: reservation.quantity,
    });
  for (const row of released) {
    await tx
      .update(inventory)
      .set({ held: sql`${inventory.held} - ${row.quantity}` })
      .where(eq(inventory.offerId, row.offerId));
  }
  return released.length;
}

/** Moves each goods line from held to sold. Returns lines that could not be secured. */
async function convertReservations(
  tx: Tx,
  quoteRow: typeof quote.$inferSelect,
): Promise<string[]> {
  const problems: string[] = [];
  for (const line of quoteRow.lines.filter((l) => l.kind === "goods")) {
    const [held] = await tx
      .select()
      .from(reservation)
      .where(
        and(
          eq(reservation.quoteId, quoteRow.id),
          eq(reservation.offerId, line.offerId),
        ),
      )
      .for("update");
    if (held?.state === "captured") continue;
    if (held?.state === "held") {
      await tx
        .update(reservation)
        .set({ state: "captured" })
        .where(eq(reservation.id, held.id));
      await tx
        .update(inventory)
        .set({
          held: sql`${inventory.held} - ${line.quantity}`,
          sold: sql`${inventory.sold} + ${line.quantity}`,
        })
        .where(eq(inventory.offerId, line.offerId));
      continue;
    }
    // The hold was released before payment finished. Take stock only if it is still there.
    const taken = await tx
      .update(inventory)
      .set({ sold: sql`${inventory.sold} + ${line.quantity}` })
      .where(
        and(
          eq(inventory.offerId, line.offerId),
          sql`${inventory.total} - ${inventory.held} - ${inventory.sold} >= ${line.quantity}`,
        ),
      )
      .returning({ offerId: inventory.offerId });
    const state = taken.length > 0 ? "captured" : "attention";
    if (held) {
      await tx
        .update(reservation)
        .set({ state })
        .where(eq(reservation.id, held.id));
    } else {
      await tx.insert(reservation).values({
        offerId: line.offerId,
        quoteId: quoteRow.id,
        quantity: line.quantity,
        state,
        expiresAt: new Date(),
      });
    }
    if (state === "attention")
      problems.push(`${line.title}: stock ran out before payment completed`);
  }
  return problems;
}

/** Commits only the verified result of the current payment executor. */
export async function recordPostgresPaidOrder(
  db: Db,
  input: PaidCommitInput,
): Promise<PaidOutcome> {
  return transaction(db, async (tx) => {
    const [attempt] = await tx
      .select()
      .from(paymentAttempt)
      .where(eq(paymentAttempt.id, input.attemptId))
      .for("update");
    if (!attempt)
      throw new Error(`payment attempt ${input.attemptId} not found`);
    const [existing] = await tx
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(eq(orders.paymentAttemptId, attempt.id));
    if (existing)
      return {
        orderId: existing.id,
        orderNumber: existing.number,
        created: false,
      };
    if (attempt.fence !== input.expectedFence)
      throw new Error(
        "The payment executor was replaced before committing its order.",
      );

    const [quoteRow] = await tx
      .select()
      .from(quote)
      .where(eq(quote.id, attempt.quoteId))
      .for("update");
    if (!quoteRow || !attempt.providerOrderId)
      throw new Error("paid attempt is missing its quote or provider order");

    assertQuotePriced(quoteRow);
    if (
      quoteRow.totalMinor !== attempt.amountMinor ||
      quoteRow.currency !== attempt.currency
    )
      throw new Error("Paid quote differs from the accepted payment");

    const snapshot: OrderSnapshot = {
      quoteId: quoteRow.id,
      quoteThreadId: quoteRow.threadId,
      quoteRevision: quoteRow.revision,
      lines: quoteRow.lines,
      charges: quoteRow.charges,
      subtotalMinor: quoteRow.subtotalMinor,
      totalMinor: quoteRow.totalMinor,
      currency: quoteRow.currency,
      policy: quoteRow.policySnapshot,
      approvedScope: quoteRow.approvedScope,
      buyerNote: quoteRow.buyerNote,
    };
    const [created] = await tx
      .insert(orders)
      .values({
        sellerId: attempt.sellerId,
        paymentAttemptId: attempt.id,
        quoteId: quoteRow.id,
        buyerSessionId: quoteRow.buyerSessionId,
        environment: attempt.environment,
        providerOrderId: attempt.providerOrderId,
        providerCaptureId: input.captureId,
        snapshot,
        totalMinor: quoteRow.totalMinor,
        currency: quoteRow.currency,
        buyerName: input.payer.name?.slice(0, 120) ?? null,
        buyerEmail: input.payer.email?.slice(0, 200) ?? null,
        paidAt: new Date(input.evidence.observedAt),
      })
      .returning({ id: orders.id, number: orders.number });
    if (!created) throw new Error("order insert returned nothing");

    const stockProblems = await convertReservations(tx, quoteRow);
    const kinds = new Set(quoteRow.lines.map((line) => line.kind));
    if (kinds.has("goods")) {
      await tx
        .insert(fulfillmentTask)
        .values({
          orderId: created.id,
          type: "pickup",
          state: stockProblems.length > 0 ? "attention" : "pending",
          lastError: stockProblems.length > 0 ? stockProblems.join("; ") : null,
        })
        .onConflictDoNothing();
    }
    if (kinds.has("service")) {
      await tx
        .insert(fulfillmentTask)
        .values([
          { orderId: created.id, type: "service_followup", state: "pending" },
          { orderId: created.id, type: "service_work", state: "pending" },
        ])
        .onConflictDoNothing();
    }
    if (kinds.has("digital")) {
      await tx
        .insert(fulfillmentTask)
        .values({
          orderId: created.id,
          type: "digital_access",
          state: "pending",
        })
        .onConflictDoNothing();
      await tx
        .insert(job)
        .values({
          kind: "grant_access",
          targetId: created.id,
          state: "pending",
        })
        .onConflictDoNothing();
    }

    await tx
      .update(quote)
      .set({ status: "consumed" })
      .where(eq(quote.id, quoteRow.id));
    await tx
      .update(paymentAttempt)
      .set({
        state: "paid",
        providerCaptureId: input.captureId,
        evidence: input.evidence,
        paidAt: new Date(input.evidence.observedAt),
        lastProviderStatus: input.evidence.captureStatus,
        lastError: null,
        uncertainSince: null,
        nextCheckAt: null,
      })
      .where(eq(paymentAttempt.id, attempt.id));
    await recordAudit(tx, {
      actor: "system",
      operation: "payment.paid",
      targetType: "order",
      targetId: created.id,
      outcome: "ok",
      details: {
        attemptId: attempt.id,
        environment: attempt.environment,
        totalMinor: quoteRow.totalMinor,
        stockProblems: stockProblems.length,
      },
    });
    return { orderId: created.id, orderNumber: created.number, created: true };
  });
}
