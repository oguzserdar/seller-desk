import { installation, offer, orders } from "@/server/db/sqlite/schema";
import type { Environment } from "@/server/db/types";
import { and, count, eq } from "drizzle-orm";
import type { ReadinessFacts } from "../readiness";
import type { D1Db } from "./client";

/** Native installation proof and readiness counts from this invocation's binding. */
export function createD1SetupStorage(db: D1Db) {
  return {
    async readinessFacts(
      sellerId: string,
      environment: Environment,
    ): Promise<ReadinessFacts> {
      const [installed, published, paid] = await db.batch([
        db.select().from(installation),
        db
          .select({ n: count() })
          .from(offer)
          .where(and(eq(offer.sellerId, sellerId), eq(offer.published, true))),
        db
          .select({ n: count() })
          .from(orders)
          .where(
            and(
              eq(orders.sellerId, sellerId),
              eq(orders.environment, environment),
            ),
          ),
      ]);
      return {
        installed: installed[0],
        published: published[0]?.n ?? 0,
        paid: paid[0]?.n ?? 0,
        databaseLabel: "Cloudflare D1",
      };
    },
  };
}
