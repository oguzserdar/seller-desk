import { getStorage } from "@/server/storage";
/** Seller-recorded delivery of paid service work, independent of payment and timing. */
import { getDb, transaction } from "@/server/db/client";
import { fulfillmentTask, orders, seller } from "@/server/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "./audit";
import { conflict, notFound } from "./errors";
import type { OwnerPrincipal } from "./principal";

/** Exact task revision and a buyer-visible account of the completed work. */
export const CompleteServiceWorkInput = z
  .object({
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(1),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

/** Records delivery and closes obsolete time follow-up atomically; never marks customer satisfaction. */
export async function completeServiceWork(
  owner: OwnerPrincipal,
  raw: z.input<typeof CompleteServiceWorkInput>,
) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.completeServiceWork(owner, raw);

  const input = CompleteServiceWorkInput.parse(raw);
  return transaction(getDb(), async (tx) => {
    const [shop] = await tx
      .select({ id: seller.id })
      .from(seller)
      .where(
        and(
          eq(seller.id, owner.sellerId),
          eq(seller.ownerUserId, owner.userId),
        ),
      )
      .for("update");
    if (!shop) throw notFound("task");
    const [owned] = await tx
      .select({ orderId: orders.id })
      .from(fulfillmentTask)
      .innerJoin(orders, eq(orders.id, fulfillmentTask.orderId))
      .where(
        and(
          eq(fulfillmentTask.id, input.taskId),
          eq(orders.sellerId, shop.id),
          eq(fulfillmentTask.type, "service_work"),
        ),
      );
    if (!owned) throw notFound("task");
    const tasks = await tx
      .select()
      .from(fulfillmentTask)
      .where(
        and(
          eq(fulfillmentTask.orderId, owned.orderId),
          inArray(fulfillmentTask.type, ["service_followup", "service_work"]),
        ),
      )
      .orderBy(asc(fulfillmentTask.id))
      .for("update");
    const work = tasks.find((task) => task.id === input.taskId);
    if (
      !work ||
      work.revision !== input.expectedRevision ||
      work.state === "completed"
    ) {
      throw conflict(
        "This service changed after you opened it. Review the current record.",
      );
    }
    const now = new Date();
    const [updated] = await tx
      .update(fulfillmentTask)
      .set({
        state: "completed",
        completedAt: now,
        lastError: null,
        revision: sql`${fulfillmentTask.revision} + 1`,
        details: { ...work.details, completionNote: input.note },
      })
      .where(eq(fulfillmentTask.id, work.id))
      .returning();
    const followUp = tasks.find((task) => task.type === "service_followup");
    if (followUp && followUp.state !== "completed") {
      await tx
        .update(fulfillmentTask)
        .set({
          state: "completed",
          completedAt: now,
          revision: sql`${fulfillmentTask.revision} + 1`,
          details: { ...followUp.details, closedBecauseWorkCompleted: true },
        })
        .where(eq(fulfillmentTask.id, followUp.id));
    }
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "fulfillment.service_work_complete",
      targetType: "fulfillment_task",
      targetId: work.id,
      outcome: "ok",
    });
    return updated!;
  });
}
