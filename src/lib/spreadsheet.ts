/**
 * Spreadsheet formula neutralization (OWASP "CSV Injection"). Any exported
 * cell that starts with a formula trigger is prefixed with a quote so Excel,
 * Sheets and Numbers show it as text instead of running it.
 */
const TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"]);

export function neutralizeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.length > 0 && TRIGGERS.has(text[0] as string) ? `'${text}` : text;
}

/** RFC 4180 quoting on top of neutralization. */
export function csvCell(value: unknown): string {
  const text = neutralizeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
