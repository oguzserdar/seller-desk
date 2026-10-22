import { getStorage } from "@/server/storage";
/**
 * Order views and fulfillment operations. Payment state and fulfillment state
 * are separate: completing pickup or recording a service follow-up never
 * rewrites the payment record.
 */
import type { OrderFollowupView } from "@/lib/order-followup";
import { secretsMatch } from "@/server/crypto";
import { getDb, transaction, type Tx } from "@/server/db/client";
import {
  accessGrant,
  digitalAsset,
  fulfillmentTask,
  offer,
  orders,
  paymentAttempt,
  seller,
} from "@/server/db/schema";
import type { OrderSnapshot, TaskDetails } from "@/server/db/types";
import { getServerConfig } from "@/server/env";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "./audit";
import { getDigitalAccessBlocks, grantToken } from "./digital";
import { conflict, invalid, notFound } from "./errors";
import { readOrderFollowup } from "./order-followup-read";
import type { BuyerPrincipal, OwnerPrincipal } from "./principal";

type TaskRow = typeof fulfillmentTask.$inferSelect;
export type TaskType = TaskRow["type"];

/** The words a buyer or owner sees for each obligation. Paid is never "done". */
/** What the owner should do next for one task, as an instruction. */
export function ownerStep(
  task: Pick<TaskRow, "type" | "state"> & Partial<Pick<TaskRow, "details">>,
): string {
  if (task.type === "pickup")
    return task.state === "completed"
      ? "Picked up"
      : task.state === "attention"
        ? "Check this pickup"
        : "Hand over at pickup";
  if (task.type === "service_followup")
    return task.details?.closedBecauseWorkCompleted
      ? "Follow-up closed after work finished"
      : task.state === "completed"
        ? "Time confirmed"
        : "Confirm a time";
  if (task.type === "service_work")
    return task.state === "completed"
      ? "Work recorded as finished"
      : "Finish the purchased work";
  return task.state === "completed"
    ? "Download delivered"
    : task.state === "attention"
      ? "Retry the download"
      : "Preparing download";
}

/** Public task status without exposing internal follow-up notes. */
export function describeTask(
  task: Pick<TaskRow, "type" | "state" | "lastError"> &
    Partial<Pick<TaskRow, "details">>,
): { label: string; detail: string; tone: "action" | "success" | "attention" } {
  if (task.type === "pickup") {
    if (task.state === "completed")
      return {
        label: "Picked up",
        detail: "The shop recorded the pickup.",
        tone: "success",
      };
    if (task.state === "attention")
      return {
        label: "Pickup needs the shop",
        detail: task.lastError ?? "The shop is checking this order.",
        tone: "attention",
      };
    return {
      label: "Paid, pickup pending",
      detail: "Bring your order number to the pickup location.",
      tone: "action",
    };
  }
  if (task.type === "service_followup") {
    if (task.details?.closedBecauseWorkCompleted)
      return {
        label: "Time follow-up closed",
        detail:
          "The shop recorded the work as finished without a separately confirmed time.",
        tone: "success",
      };
    if (task.state === "completed")
      return {
        label: "Service time confirmed",
        // Orders confirmed before the agreed time was shared keep the general wording.
        detail: task.details?.confirmedTime ? `Agreed with the shop: ${task.details.confirmedTime}` : "The shop recorded the confirmed time.",
        tone: "success",
      };
    return {
      label: "Time still to agree",
      detail: "The shop confirms a time with you. Nothing is booked yet.",
      tone: "action",
    };
  }
  if (task.type === "service_work") {
    if (task.state === "completed")
      return {
        label: "The shop marked your work finished",
        detail: `Shop's completion note: ${task.details?.completionNote ?? "No note recorded."}`,
        tone: "success",
      };
    return {
      label: "Your work is still to be finished",
      detail: "The shop has not recorded the work as finished yet.",
      tone: "action",
    };
  }
  if (task.state === "completed")
    return {
      label: "Download ready",
      detail: "Your files are ready below.",
      tone: "success",
    };
  if (task.state === "attention")
    return {
      label: "Paid, access pending",
      detail:
        "Your payment is safe. Access did not open yet; retrying does not charge you again.",
      tone: "attention",
    };
  return {
    label: "Paid, preparing access",
    detail: "Your download opens in a moment.",
    tone: "action",
  };
}

/* ---------- order access links ---------- */

const ORDER_LINK_TTL_MS = 30 * 86_400_000;

function orderKeySignature(orderId: string, expires: number): string {
  return createHmac("sha256", getServerConfig().authSecret)
    .update(`seller-desk-order:${orderId}:${expires}`)
    .digest("base64url");
}

/** A durable, expiring link credential for one order (kept in the URL fragment by the client). */
export function orderAccessKey(orderId: string, now = Date.now()): string {
  const expires = now + ORDER_LINK_TTL_MS;
  return `${expires}.${orderKeySignature(orderId, expires)}`;
}

export function checkOrderAccessKey(
  orderId: string,
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  const [expiresText, signature] = key.split(".");
  const expires = Number(expiresText);
  if (!signature || !Number.isSafeInteger(expires) || expires <= Date.now())
    return false;
  return secretsMatch(signature, orderKeySignature(orderId, expires));
}

/* ---------- buyer view ---------- */

export type BuyerOrderView = {
  id: string;
  number: number;
  environment: "fixture" | "sandbox";
  paidAt: string;
  sellerName: string;
  snapshot: OrderSnapshot;
  tasks: {
    type: TaskType;
    state: TaskRow["state"];
    label: string;
    detail: string;
    tone: "action" | "success" | "attention";
  }[];
  downloads: {
    grantId: string;
    filename: string;
    expiresAt: string;
    token: string;
  }[];
  /** Product photo per offer id, from the shop's current offers (missing when an offer was removed). */
  images: Record<string, string | null>;
  accessKey: string;
  /** True only while unfinished delivery can still be recovered under the purchased terms. */
  canRetryAccess: boolean;
  /** An order problem's history and next person to act, independent of fulfillment. */
  followup: OrderFollowupView;
};

export async function getBuyerOrder(
  access: { buyer: BuyerPrincipal | null; key: string | null },
  orderId: string,
): Promise<BuyerOrderView> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.getBuyerOrder(access, orderId);

  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw notFound("order");
  const db = getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound("order");
  const allowed =
    (access.buyer &&
      access.buyer.buyerSessionId === order.buyerSessionId &&
      access.buyer.sellerId === order.sellerId) ||
    checkOrderAccessKey(order.id, access.key);
  if (!allowed) throw notFound("order");
  const tasks = await db
    .select()
    .from(fulfillmentTask)
    .where(eq(fulfillmentTask.orderId, order.id))
    .orderBy(asc(fulfillmentTask.createdAt));
  const grants = await db
    .select({
      id: accessGrant.id,
      state: accessGrant.state,
      expiresAt: accessGrant.expiresAt,
      filename: digitalAsset.filename,
    })
    .from(accessGrant)
    .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
    .where(eq(accessGrant.orderId, order.id));
  const offerIds = order.snapshot.lines.map((line) => line.offerId);
  const photos = offerIds.length
    ? await db
        .select({ id: offer.id, imagePath: offer.imagePath })
        .from(offer)
        .where(
          and(inArray(offer.id, offerIds), eq(offer.sellerId, order.sellerId)),
        )
    : [];
  const availableGrants = grants.filter(
    (grant) => grant.state === "active" && grant.expiresAt > new Date(),
  );
  const accessEnded = availableGrants.length < grants.length;
  const accessBlock = (await getDigitalAccessBlocks([order])).get(order.id);
  return {
    id: order.id,
    number: order.number,
    environment: order.environment,
    paidAt: order.paidAt.toISOString(),
    sellerName: order.snapshot.policy.sellerName,
    snapshot: order.snapshot,
    tasks: tasks.map((task) => ({
      type: task.type,
      state: task.state,
      ...(task.type === "digital_access" && (accessEnded || accessBlock)
        ? {
            label:
              accessBlock?.code === "invalid" && !grants.length
                ? "Download needs seller review"
                : availableGrants.length
                  ? "Some download access has ended"
                  : "Download access ended",
            detail:
              "Contact the seller to review access. You do not need to pay again to ask for help.",
            tone: "attention" as const,
          }
        : describeTask(task)),
    })),
    downloads: availableGrants.map((grant) => ({
      grantId: grant.id,
      filename: grant.filename,
      expiresAt: grant.expiresAt.toISOString(),
      token: grantToken(grant.id),
    })),
    images: Object.fromEntries(
      photos.map((photo) => [photo.id, photo.imagePath]),
    ),
    accessKey: orderAccessKey(order.id),
    canRetryAccess:
      !accessBlock &&
      tasks.some(
        (task) => task.type === "digital_access" && task.state !== "completed",
      ),
    followup: await readOrderFollowup(db, order.id),
  };
}

/* ---------- owner fulfillment operations ---------- */

async function lockOwnedTask(
  tx: Tx,
  owner: OwnerPrincipal,
  taskId: string,
  expectedRevision: number,
  type: TaskType,
) {
  const [row] = await tx
    .select({ task: fulfillmentTask })
    .from(fulfillmentTask)
    .innerJoin(orders, eq(orders.id, fulfillmentTask.orderId))
    .innerJoin(
      seller,
      and(eq(seller.id, orders.sellerId), eq(seller.ownerUserId, owner.userId)),
    )
    .where(
      and(
        eq(fulfillmentTask.id, taskId),
        eq(orders.sellerId, owner.sellerId),
        eq(fulfillmentTask.type, type),
      ),
    )
    .for("update", { of: fulfillmentTask });
  if (!row) throw notFound("task");
  if (row.task.revision !== expectedRevision)
    throw conflict("This task changed after you opened it. Review it again.");
  return row.task;
}

export const CompletePickupInput = z
  .object({
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(1),
    note: z.string().trim().max(300),
  })
  .strict();

/** Records that the buyer collected their goods. */
export async function completePickup(
  owner: OwnerPrincipal,
  raw: z.input<typeof CompletePickupInput>,
): Promise<TaskRow> {
  const backend = getStorage();
  if (backend.kind === "d1") return backend.orders.completePickup(owner, raw);

  return transaction(getDb(), async (tx) => {
    const input = CompletePickupInput.parse(raw);
    await lockOwnedTask(
      tx,
      owner,
      input.taskId,
      input.expectedRevision,
      "pickup",
    );
    const [updated] = await tx
      .update(fulfillmentTask)
      .set({
        state: "completed",
        completedAt: new Date(),
        revision: sql`${fulfillmentTask.revision} + 1`,
        details: sql`${fulfillmentTask.details} || ${JSON.stringify({ pickupNote: input.note || "Picked up" } satisfies TaskDetails)}::jsonb`,
      })
      .where(
        and(
          eq(fulfillmentTask.id, input.taskId),
          eq(fulfillmentTask.revision, input.expectedRevision),
          sql`${fulfillmentTask.state} <> 'completed'`,
        ),
      )
      .returning();
    if (!updated) throw conflict("This pickup was already recorded.");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: "fulfillment.pickup_complete",
      targetType: "fulfillment_task",
      targetId: updated.id,
      outcome: "ok",
    });
    return updated;
  });
}

export const ServiceFollowUpInput = z
  .object({
    taskId: z.uuid(),
    expectedRevision: z.number().int().min(1),
    note: z.string().trim().min(3).max(500),
    timeConfirmed: z.boolean(),
  })
  .strict();

/** Records contact with a service buyer; marks it complete only when a time is actually confirmed. */
export async function recordServiceFollowUp(
  owner: OwnerPrincipal,
  raw: z.input<typeof ServiceFollowUpInput>,
): Promise<TaskRow> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.recordServiceFollowUp(owner, raw);

  return transaction(getDb(), async (tx) => {
    const input = ServiceFollowUpInput.parse(raw);
    const task = await lockOwnedTask(
      tx,
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
    ].slice(-20);
    const [updated] = await tx
      .update(fulfillmentTask)
      .set({
        state: input.timeConfirmed ? "completed" : "in_progress",
        completedAt: input.timeConfirmed ? new Date() : null,
        revision: sql`${fulfillmentTask.revision} + 1`,
        details: { ...task.details, followUps, ...(input.timeConfirmed ? { confirmedTime: input.note } : {}) },
      })
      .where(
        and(
          eq(fulfillmentTask.id, input.taskId),
          eq(fulfillmentTask.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated)
      throw conflict("This task changed after you opened it. Review it again.");
    await recordAudit(tx, {
      actor: "owner",
      actorId: owner.userId,
      operation: input.timeConfirmed
        ? "fulfillment.service_confirmed"
        : "fulfillment.service_followup",
      targetType: "fulfillment_task",
      targetId: updated.id,
      outcome: "ok",
    });
    return updated;
  });
}

/* ---------- owner order detail ---------- */

export async function getOwnerOrder(owner: OwnerPrincipal, orderId: string) {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.orders.getOwnerOrder(owner, orderId);

  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw notFound("order");
  const db = getDb();
  const [row] = await db
    .select({ order: orders, attempt: paymentAttempt })
    .from(orders)
    .innerJoin(paymentAttempt, eq(paymentAttempt.id, orders.paymentAttemptId))
    .where(and(eq(orders.id, orderId), eq(orders.sellerId, owner.sellerId)));
  if (!row) throw notFound("order");
  const tasks = await db
    .select()
    .from(fulfillmentTask)
    .where(eq(fulfillmentTask.orderId, orderId))
    .orderBy(asc(fulfillmentTask.createdAt));
  const grants = await db
    .select({
      id: accessGrant.id,
      state: accessGrant.state,
      expiresAt: accessGrant.expiresAt,
      downloadCount: accessGrant.downloadCount,
      filename: digitalAsset.filename,
    })
    .from(accessGrant)
    .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
    .where(eq(accessGrant.orderId, orderId));
  const accessBlock = (await getDigitalAccessBlocks([row.order])).get(orderId);
  return {
    order: row.order,
    attempt: row.attempt,
    tasks,
    grants,
    followup: await readOrderFollowup(db, orderId),
    accessReview: accessBlock
      ? `${accessBlock.reason} Review the purchased access terms with the buyer. Retrying cannot renew or reinstate access.`
      : null,
  };
}

export { invalid };
