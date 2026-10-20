import type { PricedQuoteLine, QuoteCharge, QuoteLine } from "@/server/db/types";
import { conflict } from "./errors";

type QuoteAmounts = { lines: QuoteLine[]; charges: QuoteCharge[]; subtotalMinor: number | null; totalMinor: number | null };

/** Refuses unknown or inconsistent prices before a quote can become a payment or order. */
export function assertQuotePriced(value: QuoteAmounts): asserts value is QuoteAmounts & { lines: PricedQuoteLine[]; subtotalMinor: number; totalMinor: number } {
  const invalid = () => conflict("This quote does not have a complete reviewed price. Ask for an updated quote.", ["requote"]);
  if (!value.lines.length || value.subtotalMinor === null || value.totalMinor === null || value.totalMinor < 1 || value.totalMinor > 100_000_000) throw invalid();
  let subtotal = 0;
  for (const line of value.lines) {
    if (line.unitAmountMinor === null || !Number.isSafeInteger(line.unitAmountMinor) || line.unitAmountMinor < 1 || line.unitAmountMinor > 10_000_000 || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 100 || line.lineTotalMinor !== line.unitAmountMinor * line.quantity) throw invalid();
    subtotal += line.lineTotalMinor;
  }
  if (value.charges.some((charge) => !Number.isSafeInteger(charge.amountMinor) || charge.amountMinor < 0)) throw invalid();
  const total = subtotal + value.charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
  if (subtotal !== value.subtotalMinor || total !== value.totalMinor) throw invalid();
}
