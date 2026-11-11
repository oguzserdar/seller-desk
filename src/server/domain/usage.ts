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

/** The largest value a usage counter can hold (a 32-bit integer column). */
export const MAX_COUNT = 2_147_483_647;

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
 * Adds an amount to the current window without a limit, such as the cost of a
 * model call that already ran. Stays within the column's integer range.
 */
export async function addUsage(
  feature: string,
  principal: string,
  windowSeconds: number,
  amount: number,
): Promise<void> {
  const value = Math.min(Math.round(amount), MAX_COUNT);
  if (!(value > 0)) return;
  const backend = getStorage();
  if (backend.kind === "d1")
    return backend.usage.addUsage(feature, principal, windowSeconds, value);

  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  await getDb().execute(sql`
    insert into usage_bucket (feature, principal, window_start, count)
    values (${feature}, ${principal}, ${windowStart.toISOString()}, ${value})
    on conflict (feature, principal, window_start)
    do update set count = least(usage_bucket.count::bigint + ${value}, ${MAX_COUNT})::integer`);
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
    throw new DomainError("rate_limited", `${message} ${tryAgainIn(usage.resetsAt.getTime() - Date.now())}`, ["browse_manually"]);
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

/**
 * When a limited person can try again, in words: minutes for a short wait, hours for a long one.
 *
 * @param waitMs - Milliseconds until the window resets
 * @returns One sentence, such as "Try again in about 9 minutes." or "Try again in about 5 hours."
 */
export function tryAgainIn(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  if (minutes <= 90) return `Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  const hours = Math.round(minutes / 60);
  return `Try again in about ${hours} hours.`;
}
