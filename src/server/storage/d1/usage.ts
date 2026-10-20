import { usageBucket } from "@/server/db/sqlite/schema";
import type { UsageResult } from "@/server/domain/usage";
import { and, eq, sql } from "drizzle-orm";
import type { D1Db } from "./client";

/** Shared native counters, bounded by one conditional upsert under concurrency. */
export function createD1UsageStorage(db: D1Db) {
  return {
    async consumeUsage(
      feature: string,
      principal: string,
      windowSeconds: number,
      limit: number,
    ): Promise<UsageResult> {
      const ms = windowSeconds * 1000,
        windowStart = new Date(Math.floor(Date.now() / ms) * ms);
      const rows = await db
        .insert(usageBucket)
        .values({ feature, principal, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [
            usageBucket.feature,
            usageBucket.principal,
            usageBucket.windowStart,
          ],
          set: { count: sql`${usageBucket.count}+1` },
          setWhere: sql`${usageBucket.count}<${limit}`,
        })
        .returning({ count: usageBucket.count });
      return {
        allowed: Boolean(rows.length),
        count: rows[0]?.count ?? limit,
        resetsAt: new Date(windowStart.getTime() + ms),
      };
    },
    async hasUsageLeft(
      feature: string,
      principal: string,
      windowSeconds: number,
      limit: number,
    ): Promise<boolean> {
      const ms = windowSeconds * 1000,
        windowStart = new Date(Math.floor(Date.now() / ms) * ms);
      const [row] = await db
        .select({ count: usageBucket.count })
        .from(usageBucket)
        .where(
          and(
            eq(usageBucket.feature, feature),
            eq(usageBucket.principal, principal),
            eq(usageBucket.windowStart, windowStart),
          ),
        );
      return (row?.count ?? 0) < limit;
    },
  };
}
