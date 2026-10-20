/**
 * Money is always an integer count of minor units (cents for USD).
 * Conversion to and from PayPal's decimal strings is done with string math,
 * never floating point, so "95.00" and 9500 always agree.
 */
const EXPONENTS: Record<string, number> = { USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2 };

/** Currencies the first release can quote. USD is the proven path. */
export const SUPPORTED_CURRENCIES = Object.keys(EXPONENTS);

export function isSupportedCurrency(currency: string): boolean {
  return currency in EXPONENTS;
}

function exponentOf(currency: string): number {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) throw new Error(`Unsupported currency ${currency}`);
  return exponent;
}

/** 9500, "USD" -> "$95.00" for display. */
export function formatMoney(minor: number, currency: string): string {
  const exponent = exponentOf(currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / 10 ** exponent);
}

/** 9500, "USD" -> "95.00", the exact value string PayPal expects. */
export function toProviderValue(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Amount must be a non-negative integer of minor units");
  const exponent = exponentOf(currency);
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, "0");
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** "95.00", "USD" -> 9500. Returns null for anything that is not an exact amount. */
export function fromProviderValue(value: string, currency: string): number | null {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) return null;
  const pattern = exponent === 0 ? /^(\d{1,12})$/ : new RegExp(`^(\\d{1,12})\\.(\\d{${exponent}})$`);
  const match = pattern.exec(value);
  if (!match) return null;
  const minor = Number(`${match[1]}${match[2] ?? ""}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Parses an owner-typed price such as "95", "95.5" or "$1,095.00" into minor units. */
export function parsePriceInput(input: string, currency: string): number | null {
  const exponent = EXPONENTS[currency];
  if (exponent === undefined) return null;
  const text = input.trim();
  if (!/^(?:[$€£]\s*)?(?:\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.\d{1,2})?$/.test(text)) return null;
  const cleaned = text.replace(/^[$€£]\s*/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(exponent, "0").slice(0, exponent);
  const minor = Number(`${match[1]}${fraction}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Displays a quote without treating an unknown price as zero. */
export function formatQuoteAmount(minor: number | null, currency: string): string {
  return minor === null ? "Awaiting quote" : formatMoney(minor, currency);
}
