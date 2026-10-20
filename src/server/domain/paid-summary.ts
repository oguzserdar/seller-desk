/** Paid receipt totals across the whole shop, with explicit calendar and currency boundaries. */
import { formatMoney } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { orders } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { Temporal } from "@js-temporal/polyfill";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { OwnerPrincipal } from "./principal";

/** A display preference, never an authorization scope. Invalid zones fail validation. */
export const ReportingTimeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");

/** Bounded periods supported by the owner assistant. */
export const PAID_PERIODS = [
  "today",
  "yesterday",
  "last_7_days",
  "all_time",
] as const;
const Input = z
  .object({ period: z.enum(PAID_PERIODS), timeZone: ReportingTimeZone })
  .strict();

/**
 * Sums verified paid orders, without the desk's display-row limit. Each currency
 * stays separate. Both backends use the first instant of each calendar day, including
 * repeated midnights and daylight-saving days shorter or longer than 24 hours. This is gross receipts, not profit,
 * settled balance, or net-of-fees/refunds revenue. `now` is the server clock.
 */
export async function readPaidSummary(
  owner: OwnerPrincipal,
  raw: z.input<typeof Input>,
  now = new Date(),
) {
  const { period, timeZone } = Input.parse(raw);
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
  const startDate =
    period === "all_time"
      ? null
      : today
          .add({
            days:
              period === "yesterday" ? -1 : period === "last_7_days" ? -6 : 0,
          })
          .toString();
  const endDateExclusive =
    period === "all_time"
      ? null
      : today.add({ days: period === "yesterday" ? 0 : 1 }).toString();
  const start = startDate
    ? new Date(
        Temporal.PlainDate.from(startDate).toZonedDateTime(
          timeZone,
        ).epochMilliseconds,
      )
    : null;
  const end = endDateExclusive
    ? new Date(
        Temporal.PlainDate.from(endDateExclusive).toZonedDateTime(
          timeZone,
        ).epochMilliseconds,
      )
    : null;
  const backend = getStorage();
  const totals =
    backend.kind === "d1"
      ? await backend.reports.paidRows(owner, { start, end, now })
      : await getDb()
          .select({
            currency: orders.currency,
            paidOrders: sql<number>`count(*)::integer`,
            paidMinorText: sql<string>`sum(${orders.totalMinor})::text`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.sellerId, owner.sellerId),
              lte(orders.paidAt, now),
              start ? gte(orders.paidAt, start) : undefined,
              end ? lt(orders.paidAt, end) : undefined,
            ),
          )
          .groupBy(orders.currency)
          .orderBy(orders.currency);
  return {
    period,
    timeZone,
    startDate,
    endDateExclusive,
    asOf: now.toISOString(),
    basis:
      "Verified paid orders recorded in this Seller Desk installation. Gross receipts; excludes pending payments and does not subtract refunds or fees. Not the PayPal account balance.",
    totals: totals.map(({ currency, paidOrders, paidMinorText }) => {
      const paidMinor = Number(paidMinorText);
      if (!Number.isSafeInteger(paidMinor))
        throw new Error("Paid total exceeds the supported exact amount.");
      return {
        currency,
        paidOrders,
        paidMinor,
        paidLabel: formatMoney(paidMinor, currency),
      };
    }),
  };
}
