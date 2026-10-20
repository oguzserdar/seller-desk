/**
 * A receipt can only restate what was recorded. The model is told this, but in
 * real runs it still forwarded "a receipt showing USD 25" for a USD 35 order to
 * the owner when the customer asked it to. This check refuses that question in code.
 */
const DOCUMENT = /\b(receipts?|invoices?|credit[- ]?notes?|expense|addendum|statements?|supporting (?:letter|document))\b/i;
const MONEY = /(?:[$€£]|\b(?:USD|CAD|EUR|GBP|AUD)\s?)(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:USD|CAD|EUR|GBP|AUD|dollars?)\b/gi;

const amountsIn = (text: string): number[] =>
  [...text.matchAll(MONEY)].map((match) => Number((match[1] ?? match[2] ?? "").replaceAll(",", ""))).filter(Number.isFinite);

/**
 * True when a question asks for a receipt, invoice or similar document and names
 * an amount that matches none of the customer's recorded purchases.
 */
export function misleadingDocumentRequest(text: string, recordedAmounts: string[]): boolean {
  if (!DOCUMENT.test(text)) return false;
  const recorded = new Set(recordedAmounts.flatMap((value) => (value.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replaceAll(",", "")))));
  return amountsIn(text).some((amount) => !recorded.has(amount));
}
