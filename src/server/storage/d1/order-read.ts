import {
  accessGrant,
  digitalAsset,
  fulfillmentTask,
  offer,
  orders,
  paymentAttempt,
} from "@/server/db/sqlite/schema";
import { grantToken } from "@/server/domain/digital";
import { notFound } from "@/server/domain/errors";
import {
  checkOrderAccessKey,
  describeTask,
  orderAccessKey,
  type BuyerOrderView,
} from "@/server/domain/orders";
import type { BuyerPrincipal, OwnerPrincipal } from "@/server/domain/principal";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { D1Db } from "./client";
import { createD1DigitalReads } from "./digital-read";
import { ownerScope } from "./guards";
import { readD1OrderFollowup } from "./order-followup";

/** Native paid-order views preserve authorization, purchased terms and separate fulfilment. */
export function createD1OrderReads(db: D1Db) {
  return {
    async getBuyerOrder(
      access: { buyer: BuyerPrincipal | null; key: string | null },
      id: string,
    ): Promise<BuyerOrderView> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("order");
      const [order] = await db.select().from(orders).where(eq(orders.id, id));
      if (!order) throw notFound("order");
      const allowed =
        (access.buyer &&
          access.buyer.buyerSessionId === order.buyerSessionId &&
          access.buyer.sellerId === order.sellerId) ||
        checkOrderAccessKey(order.id, access.key);
      if (!allowed) throw notFound("order");
      const ids = order.snapshot.lines.map((line) => line.offerId);
      const [tasks, grants, photos] = await db.batch([
        db
          .select()
          .from(fulfillmentTask)
          .where(eq(fulfillmentTask.orderId, id))
          .orderBy(asc(fulfillmentTask.createdAt)),
        db
          .select({
            id: accessGrant.id,
            state: accessGrant.state,
            expiresAt: accessGrant.expiresAt,
            filename: digitalAsset.filename,
          })
          .from(accessGrant)
          .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
          .where(eq(accessGrant.orderId, id)),
        db
          .select({ id: offer.id, imagePath: offer.imagePath })
          .from(offer)
          .where(
            and(inArray(offer.id, ids), eq(offer.sellerId, order.sellerId)),
          ),
      ]);
      const available = grants.filter(
          (grant) => grant.state === "active" && grant.expiresAt > new Date(),
        ),
        ended = available.length < grants.length,
        block = (
          await createD1DigitalReads(db).getDigitalAccessBlocks([order])
        ).get(id);
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
          ...(task.type === "digital_access" && (ended || block)
            ? {
                label:
                  block?.code === "invalid" && !grants.length
                    ? "Download needs seller review"
                    : available.length
                      ? "Some download access has ended"
                      : "Download access ended",
                detail:
                  "Contact the seller to review access. You do not need to pay again to ask for help.",
                tone: "attention" as const,
              }
            : describeTask(task)),
        })),
        downloads: available.map((grant) => ({
          grantId: grant.id,
          filename: grant.filename,
          expiresAt: grant.expiresAt.toISOString(),
          token: grantToken(grant.id),
        })),
        images: Object.fromEntries(
          photos.map((photo) => [photo.id, photo.imagePath]),
        ),
        accessKey: orderAccessKey(id),
        canRetryAccess:
          !block &&
          tasks.some(
            (task) =>
              task.type === "digital_access" && task.state !== "completed",
          ),
        followup: await readD1OrderFollowup(db, id),
      };
    },
    async getOwnerOrder(owner: OwnerPrincipal, id: string) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("order");
      const [row] = await db
        .select({ order: orders, attempt: paymentAttempt })
        .from(orders)
        .innerJoin(
          paymentAttempt,
          eq(paymentAttempt.id, orders.paymentAttemptId),
        )
        .where(
          and(
            eq(orders.id, id),
            eq(orders.sellerId, owner.sellerId),
            ownerScope(owner),
          ),
        );
      if (!row) throw notFound("order");
      const [tasks, grants] = await db.batch([
        db
          .select()
          .from(fulfillmentTask)
          .where(eq(fulfillmentTask.orderId, id))
          .orderBy(asc(fulfillmentTask.createdAt)),
        db
          .select({
            id: accessGrant.id,
            state: accessGrant.state,
            expiresAt: accessGrant.expiresAt,
            downloadCount: accessGrant.downloadCount,
            filename: digitalAsset.filename,
          })
          .from(accessGrant)
          .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
          .where(eq(accessGrant.orderId, id)),
      ]);
      const block = (
        await createD1DigitalReads(db).getDigitalAccessBlocks([row.order])
      ).get(id);
      return {
        ...row,
        tasks,
        grants,
        followup: await readD1OrderFollowup(db, id),
        accessReview: block
          ? `${block.reason} Review the purchased access terms with the buyer. Retrying cannot renew or reinstate access.`
          : null,
      };
    },
  };
}
