import { auditEvent, fulfillmentTask, orders } from "@/server/db/sqlite/schema";
import { conflict, notFound } from "@/server/domain/errors";
import {
  CompletePickupInput,
  ServiceFollowUpInput,
} from "@/server/domain/orders";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { CompleteServiceWorkInput } from "@/server/domain/service-work";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { D1Db } from "./client";
import {
  batchGuard,
  clearBatchGuards,
  isBatchGuardFailure,
  ownerScope,
} from "./guards";

type Task = typeof fulfillmentTask.$inferSelect;
async function loadTask(
  db: D1Db,
  owner: OwnerPrincipal,
  id: string,
  revision: number,
  type: Task["type"],
): Promise<Task> {
  const [row] = await db
    .select({ task: fulfillmentTask })
    .from(fulfillmentTask)
    .innerJoin(orders, eq(orders.id, fulfillmentTask.orderId))
    .where(
      and(
        eq(fulfillmentTask.id, id),
        eq(orders.sellerId, owner.sellerId),
        eq(fulfillmentTask.type, type),
        ownerScope(owner),
      ),
    );
  if (!row) throw notFound("task");
  if (row.task.revision !== revision)
    throw conflict("This task changed after you opened it. Review it again.");
  return row.task;
}
function taskGuard(owner: OwnerPrincipal, task: Task) {
  return sql`${ownerScope(owner)} and exists(select 1 from fulfillment_task t join orders o on o.id=t.order_id where t.id=${task.id} and o.seller_id=${owner.sellerId} and t.type=${task.type} and t.revision=${task.revision} and t.state=${task.state})`;
}

/** Native fulfilment commands never change the payment state or assert customer satisfaction. */
export function createD1OrderWrites(db: D1Db) {
  return {
    async completePickup(
      owner: OwnerPrincipal,
      raw: z.input<typeof CompletePickupInput>,
    ): Promise<Task> {
      const input = CompletePickupInput.parse(raw),
        task = await loadTask(
          db,
          owner,
          input.taskId,
          input.expectedRevision,
          "pickup",
        );
      if (task.state === "completed")
        throw conflict("This pickup was already recorded.");
      const execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(db, `${execution}:pickup`, taskGuard(owner, task)),
          db
            .update(fulfillmentTask)
            .set({
              state: "completed",
              completedAt: new Date(),
              revision: task.revision + 1,
              details: {
                ...task.details,
                pickupNote: input.note || "Picked up",
              },
            })
            .where(eq(fulfillmentTask.id, task.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "fulfillment.pickup_complete",
              targetType: "fulfillment_task",
              targetId: task.id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This pickup changed after you opened it. Review it again.",
          );
        throw error;
      }
    },
    async recordServiceFollowUp(
      owner: OwnerPrincipal,
      raw: z.input<typeof ServiceFollowUpInput>,
    ): Promise<Task> {
      const input = ServiceFollowUpInput.parse(raw),
        task = await loadTask(
          db,
          owner,
          input.taskId,
          input.expectedRevision,
          "service_followup",
        );
      if (task.state === "completed")
        throw conflict("This service time is already confirmed.");
      const followUps = [
          ...(task.details.followUps ?? []),
          { note: input.note, recordedAt: new Date().toISOString() },
        ].slice(-20),
        execution = crypto.randomUUID();
      try {
        const [, rows] = await db.batch([
          batchGuard(db, `${execution}:timing`, taskGuard(owner, task)),
          db
            .update(fulfillmentTask)
            .set({
              state: input.timeConfirmed ? "completed" : "in_progress",
              completedAt: input.timeConfirmed ? new Date() : null,
              revision: task.revision + 1,
              details: { ...task.details, followUps },
            })
            .where(eq(fulfillmentTask.id, task.id))
            .returning(),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: input.timeConfirmed
                ? "fulfillment.service_confirmed"
                : "fulfillment.service_followup",
              targetType: "fulfillment_task",
              targetId: task.id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This task changed after you opened it. Review it again.",
          );
        throw error;
      }
    },
    async completeServiceWork(
      owner: OwnerPrincipal,
      raw: z.input<typeof CompleteServiceWorkInput>,
    ): Promise<Task> {
      const input = CompleteServiceWorkInput.parse(raw),
        work = await loadTask(
          db,
          owner,
          input.taskId,
          input.expectedRevision,
          "service_work",
        );
      if (work.state === "completed")
        throw conflict(
          "This service changed after you opened it. Review the current record.",
        );
      const [followUp] = await db
        .select()
        .from(fulfillmentTask)
        .where(
          and(
            eq(fulfillmentTask.orderId, work.orderId),
            eq(fulfillmentTask.type, "service_followup"),
          ),
        );
      const execution = crypto.randomUUID(),
        now = new Date();
      try {
        const [, rows] = await db.batch([
          batchGuard(
            db,
            `${execution}:work`,
            sql`${taskGuard(owner, work)} and ${followUp ? sql`exists(select 1 from fulfillment_task where id=${followUp.id} and revision=${followUp.revision} and state=${followUp.state})` : sql`not exists(select 1 from fulfillment_task where order_id=${work.orderId} and type='service_followup')`}`,
          ),
          db
            .update(fulfillmentTask)
            .set({
              state: "completed",
              completedAt: now,
              lastError: null,
              revision: work.revision + 1,
              details: { ...work.details, completionNote: input.note },
            })
            .where(eq(fulfillmentTask.id, work.id))
            .returning(),
          ...(followUp && followUp.state !== "completed"
            ? [
                db
                  .update(fulfillmentTask)
                  .set({
                    state: "completed",
                    completedAt: now,
                    revision: followUp.revision + 1,
                    details: {
                      ...followUp.details,
                      closedBecauseWorkCompleted: true,
                    },
                  })
                  .where(eq(fulfillmentTask.id, followUp.id)),
              ]
            : []),
          db
            .insert(auditEvent)
            .values({
              actor: "owner",
              actorId: owner.userId,
              operation: "fulfillment.service_work_complete",
              targetType: "fulfillment_task",
              targetId: work.id,
              outcome: "ok",
            }),
          clearBatchGuards(db, execution),
        ]);
        return rows[0]!;
      } catch (error) {
        if (isBatchGuardFailure(error))
          throw conflict(
            "This service changed after you opened it. Review the current record.",
          );
        throw error;
      }
    },
  };
}
