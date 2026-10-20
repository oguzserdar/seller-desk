import { orders, seller } from "@/server/db/sqlite/schema";
import { notFound } from "@/server/domain/errors";
import type { OwnerPrincipal } from "@/server/domain/principal";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { D1Db } from "./client";
/** Native exact per-currency totals over shared calendar boundaries, independent of the desk row limit. */
export async function readD1PaidRows(
  db: D1Db,
  owner: OwnerPrincipal,
  bounds: { start: Date | null; end: Date | null; now: Date },
) {
  const [shop] = await db
    .select({ id: seller.id })
    .from(seller)
    .where(
      and(eq(seller.id, owner.sellerId), eq(seller.ownerUserId, owner.userId)),
    );
  if (!shop) throw notFound("shop");
  return db
    .select({
      currency: orders.currency,
      paidOrders: sql<number>`count(*)`,
      paidMinorText: sql<string>`cast(sum(${orders.totalMinor}) as text)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.sellerId, owner.sellerId),
        lte(orders.paidAt, bounds.now),
        bounds.start ? gte(orders.paidAt, bounds.start) : undefined,
        bounds.end ? lt(orders.paidAt, bounds.end) : undefined,
      ),
    )
    .groupBy(orders.currency)
    .orderBy(orders.currency);
}
