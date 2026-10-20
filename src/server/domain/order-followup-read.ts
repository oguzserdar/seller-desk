import { desc, eq } from "drizzle-orm";
import type { OrderFollowupView } from "@/lib/order-followup";
import type { Queryable } from "@/server/db/client";
import { orderFollowup } from "@/server/db/schema";

/** Internal projection. Caller must first prove access to the enclosing order. */
export async function readOrderFollowup(db: Queryable, orderId: string): Promise<OrderFollowupView> {
  const recent = await db.select().from(orderFollowup).where(eq(orderFollowup.orderId, orderId)).orderBy(desc(orderFollowup.revision)).limit(21);
  const latest = recent[0];
  return {
    state: latest?.state ?? "none", revision: latest?.revision ?? 0,
    nextActor: latest?.state === "needs_help" ? "seller" : latest?.state === "awaiting_customer" ? "buyer" : null,
    history: recent.slice(0, 20).reverse().map(row => ({ revision: row.revision, actor: row.actor, state: row.state, message: row.message, at: row.createdAt.toISOString() })),
    earlierMessages: recent.length > 20,
  };
}
