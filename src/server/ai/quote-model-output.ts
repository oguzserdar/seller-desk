/** Quote facts for model answers; full tool evidence stays available to the interface. */
import { QUOTE_STATUS } from "@/lib/quote-status";
import type { EffectiveQuoteStatus } from "@/server/domain/quotes";

/** Maps a server quote state to the same words shown on its buyer card. */
export function quoteStatusForModel(status: EffectiveQuoteStatus): string {
  return QUOTE_STATUS[status]!.label;
}

/** Removes handles unused by buyer tools without editing generated assistant text. */
export function quoteFactsForModel(output: {
  status: EffectiveQuoteStatus; totalMinor: number | null; currency: string;
  lines: { title: string; quantity: number; lineTotalMinor: number | null }[];
  unresolved: { message: string }[]; reviewReason: string | null;
} | { error: string }) {
  if ("error" in output) return output;
  return {
    status: quoteStatusForModel(output.status), totalMinor: output.totalMinor, currency: output.currency,
    lines: output.lines.map(({ title, quantity, lineTotalMinor }) => ({ title, quantity, lineTotalMinor })),
    unresolved: output.unresolved.map(({ message }) => ({ message })), reviewReason: output.reviewReason,
  };
}
