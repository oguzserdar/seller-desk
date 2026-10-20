import { getStorage } from "@/server/storage";
/**
 * Atomic usage counters in PostgreSQL, shared by every app instance. Used for
 * AI spend limits and pre-auth request limits. A request that would exceed the
 * limit is refused before any model work.
 */
import { getDb } from "@/server/db/client";
import { sql } from "drizzle-orm";
import { DomainError } from "./errors";

export type UsageResult = { allowed: boolean; count: number; resetsAt: Date };

export async function consumeUsage(
  feature: string,
  principal: string,
  windowSeconds: number,
  limit: number,
): Promise<UsageResult> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.usage.consumeUsage(feature, principal, windowSeconds, limit);

  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const result = await getDb().execute(sql`
    insert into usage_bucket (feature, principal, window_start, count)
    values (${feature}, ${principal}, ${windowStart.toISOString()}, 1)
    on conflict (feature, principal, window_start)
    do update set count = usage_bucket.count + 1
    where usage_bucket.count < ${limit}
    returning count`);
  const row = result.rows[0] as { count: number } | undefined;
  return {
    allowed: Boolean(row),
    count: row?.count ?? limit,
    resetsAt: new Date(windowStart.getTime() + windowMs),
  };
}

/**
 * Whether the current window still has room, without spending any of it. Callers
 * still consume right before the work, so a race here cannot exceed the limit.
 */
export async function hasUsageLeft(
  feature: string,
  principal: string,
  windowSeconds: number,
  limit: number,
): Promise<boolean> {
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.usage.hasUsageLeft(feature, principal, windowSeconds, limit);

  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const result = await getDb().execute(sql`
    select count from usage_bucket
    where feature = ${feature} and principal = ${principal} and window_start = ${windowStart.toISOString()}`);
  const row = result.rows[0] as { count: number } | undefined;
  return (row?.count ?? 0) < limit;
}

/** Throws a friendly rate-limit error when the counter is full. */
export async function requireUsage(
  feature: string,
  principal: string,
  windowSeconds: number,
  limit: number,
  message: string,
): Promise<void> {
  const usage = await consumeUsage(feature, principal, windowSeconds, limit);
  if (!usage.allowed) {
    const minutes = Math.max(
      1,
      Math.ceil((usage.resetsAt.getTime() - Date.now()) / 60_000),
    );
    throw new DomainError(
      "rate_limited",
      `${message} Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      ["browse_manually"],
    );
  }
}

/** The client address from the host's trusted header (configure CLIENT_IP_HEADER per host). */
export function clientKey(headers: Headers): string {
  const configured = process.env.CLIENT_IP_HEADER?.toLowerCase();
  const raw = configured
    ? headers.get(configured)
    : headers.get("x-forwarded-for");
  const first = raw?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown-client";
}
