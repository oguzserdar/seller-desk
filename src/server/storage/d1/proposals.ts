import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  auditEvent,
  fulfillmentTask,
  orders,
  ownerProposal,
  paymentAttempt,
} from "@/server/db/sqlite/schema";
import type { ProposalResult } from "@/server/db/types";
import { conflict, notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, eq, lt, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";
/** Native persistence for explicit seller approvals; provider work stays in the shared orchestrator. */
export function createD1Proposals(db: D1Db) {
  return {
    async openTask(
      owner: OwnerPrincipal,
      id: string,
      type: "pickup" | "digital_access",
    ) {
      const [row] = await db
        .select({ order: orders, task: fulfillmentTask })
        .from(orders)
        .innerJoin(
          fulfillmentTask,
          and(
            eq(fulfillmentTask.orderId, orders.id),
            eq(fulfillmentTask.type, type),
          ),
        )
        .where(
          and(
            eq(orders.id, id),
            eq(orders.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      return row;
    },
    async payment(owner: OwnerPrincipal, id: string) {
      const [row] = await db
        .select()
        .from(paymentAttempt)
        .where(
          and(
            eq(paymentAttempt.id, id),
            eq(paymentAttempt.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      return row;
    },
    async insert(
      owner: OwnerPrincipal,
      values: typeof ownerProposal.$inferInsert,
    ) {
      const execution = crypto.randomUUID();
      const [, rows] = await db.batch([
        batchGuard(db, `${execution}:owner`, ownerScope(owner)),
        db.insert(ownerProposal).values(values).returning(),
        clearBatchGuards(db, execution),
      ]);
      return rows[0]!;
    },
    async claim(owner: OwnerPrincipal, id: string, approve: boolean) {
      const execution = crypto.randomUUID();
      try {
        const [, , claimed, existing] = await db.batch([
          batchGuard(db, `${execution}:owner`, ownerScope(owner)),
          db
            .update(ownerProposal)
            .set({ state: "expired" })
            .where(
              and(
                eq(ownerProposal.id, id),
                eq(ownerProposal.sellerId, owner.sellerId),
                eq(ownerProposal.state, "pending"),
                lt(ownerProposal.expiresAt, nowMilliseconds),
              ),
            ),
          db
            .update(ownerProposal)
            .set({
              state: approve ? "executed" : "rejected",
              decidedAt: new Date(),
            })
            .where(
              and(
                eq(ownerProposal.id, id),
                eq(ownerProposal.sellerId, owner.sellerId),
                eq(ownerProposal.state, "pending"),
              ),
            )
            .returning(),
          db
            .select()
            .from(ownerProposal)
            .where(
              and(
                eq(ownerProposal.id, id),
                eq(ownerProposal.sellerId, owner.sellerId),
              ),
            ),
          clearBatchGuards(db, execution),
        ]);
        if (claimed[0]) return claimed[0];
        if (!existing[0]) throw notFound("proposal");
        throw conflict(
          existing[0].state === "expired"
            ? "This suggestion expired. Ask again for a fresh one."
            : "This suggestion was already decided.",
        );
      } catch (error) {
        if (isBatchGuardFailure(error)) throw notFound("shop");
        throw error;
      }
    },
    async finish(
      owner: OwnerPrincipal,
      row: typeof ownerProposal.$inferSelect,
      result: ProposalResult | null,
    ) {
      const execution = crypto.randomUUID();
      await db.batch([
        batchGuard(
          db,
          `${execution}:owner`,
          sql`${ownerScope(owner)} and exists(select 1 from owner_proposal where id=${row.id} and seller_id=${owner.sellerId} and state=${row.state})`,
        ),
        ...(result
          ? [
              db
                .update(ownerProposal)
                .set({
                  state: result.outcome === "failed" ? "failed" : "executed",
                  result,
                })
                .where(eq(ownerProposal.id, row.id)),
            ]
          : []),
        db
          .insert(auditEvent)
          .values({
            actor: "owner",
            actorId: owner.userId,
            operation: `proposal.${row.verb}`,
            targetType: "owner_proposal",
            targetId: row.id,
            outcome: result
              ? result.outcome === "failed"
                ? "failed"
                : "ok"
              : "noop",
          }),
        clearBatchGuards(db, execution),
      ]);
    },
  };
}
