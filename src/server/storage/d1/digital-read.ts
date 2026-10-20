import { sha256Hex } from "@/server/crypto";
import { nowMilliseconds } from "@/server/db/sqlite/columns";
import {
  accessGrant,
  digitalAsset,
  digitalQuoteLine,
  orders,
} from "@/server/db/sqlite/schema";
import {
  inspectAccess,
  type AccessBlock,
  type AccessOrder,
  type Download,
} from "@/server/domain/digital";
import { DomainError, notFound } from "@/server/domain/errors";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";
import { batchGuard, clearBatchGuards, isBatchGuardFailure } from "./guards";

/** Native D1 private file reads and delivery eligibility. */
export function createD1DigitalReads(db: D1Db) {
  return {
    async getDigitalAccessBlocks(
      authorizedOrders: AccessOrder[],
    ): Promise<Map<string, AccessBlock>> {
      const digital = authorizedOrders.filter((order) =>
        order.snapshot.lines.some((line) => line.kind === "digital"),
      );
      const result = new Map<string, AccessBlock>();
      if (!digital.length) return result;
      // One JSON parameter retains indexed membership without D1's 100-bind limit.
      const [sources, grants] = await db.batch([
        db
          .select()
          .from(digitalQuoteLine)
          .where(
            sql`${digitalQuoteLine.quoteId} in (select value from json_each(${JSON.stringify(digital.map((order) => order.quoteId))}))`,
          ),
        db
          .select()
          .from(accessGrant)
          .where(
            sql`${accessGrant.orderId} in (select value from json_each(${JSON.stringify(digital.map((order) => order.id))}))`,
          ),
      ]);
      const bySource = new Map(
          sources.map((row) => [`${row.quoteId}:${row.offerId}`, row]),
        ),
        byGrant = new Map(
          grants.map((row) => [`${row.orderId}:${row.assetId}`, row]),
        );
      for (const order of digital)
        for (const line of order.snapshot.lines.filter(
          (line) => line.kind === "digital",
        )) {
          const source = bySource.get(`${order.quoteId}:${line.offerId}`),
            checked = inspectAccess(
              source,
              source ? byGrant.get(`${order.id}:${source.assetId}`) : undefined,
              order.paidAt,
              new Date(),
            );
          if (!checked.ok) {
            result.set(order.id, checked.block);
            break;
          }
        }
      return result;
    },
    async downloadWithGrant(grantId: string, token: string): Promise<Download> {
      if (
        !/^[0-9a-f-]{36}$/i.test(grantId) ||
        !/^[A-Za-z0-9_-]{20,100}$/.test(token)
      )
        throw notFound("download");
      const [row] = await db
        .select({ grant: accessGrant, asset: digitalAsset })
        .from(accessGrant)
        .innerJoin(digitalAsset, eq(digitalAsset.id, accessGrant.assetId))
        .innerJoin(orders, eq(orders.id, accessGrant.orderId))
        .where(
          and(
            eq(accessGrant.id, grantId),
            eq(accessGrant.capabilityHash, sha256Hex(token)),
          ),
        );
      if (!row || row.grant.state !== "active") throw notFound("download");
      if (row.grant.expiresAt <= new Date())
        throw new DomainError(
          "expired",
          "This download link has expired. Contact the seller to renew access.",
          ["contact_seller"],
        );
      const execution = crypto.randomUUID();
      try {
        await db.batch([
          batchGuard(
            db,
            `${execution}:download`,
            sql`exists(select 1 from access_grant g join orders o on o.id=g.order_id where g.id=${grantId} and g.capability_hash=${sha256Hex(token)} and g.state='active' and g.expires_at>${nowMilliseconds} and g.asset_id=${row.asset.id})`,
          ),
          db
            .update(accessGrant)
            .set({
              downloadCount: sql`${accessGrant.downloadCount}+1`,
              lastDownloadAt: new Date(),
            })
            .where(eq(accessGrant.id, grantId)),
          clearBatchGuards(db, execution),
        ]);
      } catch (error) {
        if (isBatchGuardFailure(error)) throw notFound("download");
        throw error;
      }
      return {
        filename: row.asset.filename,
        mimeType: row.asset.mimeType,
        bytes: row.asset.bytes,
      };
    },
  };
}
