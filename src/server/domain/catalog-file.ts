import { parse } from "csv-parse/sync";
import { parsePriceInput } from "@/lib/money";
import type { OfferKind } from "@/server/db/types";
import { invalid } from "./errors";

/** Maximum number of product records reviewed in one import. */
export const MAX_IMPORT_LINES = 50;
/** Matches the stored import source constraint. */
export const MAX_IMPORT_CHARS = 20_000;
/** One source record and its validation result; invalid records cannot be added. */
export type ImportRow = {
  line: number;
  title: string;
  kind: OfferKind;
  unitAmountMinor: number | null;
  stock: number | null;
  problem: string | null;
};

const KINDS: Record<string, OfferKind> = {
  "": "goods", goods: "goods", pickup: "goods",
  service: "service", services: "service", repair: "service", booking: "service", appointment: "service",
  download: "digital", digital: "digital", file: "digital", files: "digital",
};

function priceInCurrency(raw: string, currency: string): number | null {
  const match = /^(?:(USD|CAD|AUD|EUR|GBP)\s+|([$£€])\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match || (match[1] && match[1] !== currency)) return null;
  if (match[2] && match[2] !== (currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$")) return null;
  const minor = parsePriceInput(`${match[3]}${match[4] ? `.${match[4]}` : ""}`, currency);
  return minor !== null && minor <= 10_000_000 ? minor : null;
}

function separatorOf(text: string): string {
  const candidates = [",", "\t"].filter((delimiter) => {
    try {
      const [first] = parse(text, { delimiter, bom: true, trim: true, skip_empty_lines: true, to: 1 });
      return first && first.length >= 2;
    } catch { return false; }
  });
  if (candidates.length !== 1) throw invalid("Use one separator throughout: commas for CSV or tabs for TSV. Quote names containing separators.");
  return candidates[0]!;
}

/** Reads bounded UTF-8 CSV/TSV with quoted fields, BOMs, and explicit platform mappings. */
export function readCatalogFile(text: string, currency: string) {
  if (!text.trim()) throw invalid("Choose a file or paste a list first.");
  if (text.length > MAX_IMPORT_CHARS) throw invalid("Use a smaller file, up to 20,000 characters.");
  let records: string[][];
  const delimiter = separatorOf(text);
  try {
    records = parse(text, {
      delimiter, bom: true, trim: true, skip_empty_lines: true, relax_column_count: true, max_record_size: MAX_IMPORT_CHARS,
    });
  } catch {
    throw invalid("The file has broken quotes or separators. Export it again as UTF-8 CSV or tab-separated text.");
  }
  const headers = (records[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const shopify = headers.includes("title") && headers.includes("url handle");
  const woo = headers.includes("name") && headers.includes("regular price");
  const named = shopify || woo || (headers.some((key) => ["name", "title", "item"].includes(key)) && headers.includes("price"));
  const format = shopify ? "Shopify CSV" : woo ? "WooCommerce CSV" : "Price list";
  if (named && new Set(headers).size !== headers.length) throw invalid("The file has duplicate column names. Give each column one name.");
  const data = named ? records.slice(1) : records;
  if (data.length === 0) throw invalid("The file has headings but no products.");
  if (data.length > MAX_IMPORT_LINES) throw invalid(`Import up to ${MAX_IMPORT_LINES} product rows at a time. Nothing was added.`);
  const get = (cells: string[], key: string) => (cells[headers.indexOf(key)] ?? "").trim();
  const variantHandles = new Set<string>();
  if (shopify) {
    for (const cells of data) {
      if ([1, 2, 3].some((n) => {
        const value = get(cells, `option${n} value`).toLowerCase();
        return value && value !== "default title";
      })) variantHandles.add(get(cells, "url handle"));
    }
  }
  const rows: ImportRow[] = data.map((cells, index) => {
    let title = cells[0]?.trim() ?? "";
    let price = cells[1]?.trim() ?? "";
    let stockCell = cells[2]?.trim() ?? "";
    let kindWord = cells[3]?.trim().toLowerCase() ?? "";
    let problem: string | null = null;
    if (named) {
      if (cells.length !== headers.length) problem = "This row does not match the column headings.";
      title = get(cells, shopify ? "title" : headers.includes("name") ? "name" : headers.includes("title") ? "title" : "item");
      price = get(cells, woo ? "regular price" : "price");
      stockCell = get(cells, shopify ? "inventory quantity" : "stock");
      kindWord = get(cells, "type").toLowerCase();
    } else {
      if (cells.length < 2 || cells.length > 4) problem = "Use name, price, stock, type, with two to four columns.";
      if (cells.length === 3 && Object.hasOwn(KINDS, stockCell.toLowerCase()) && stockCell !== "") {
        kindWord = stockCell.toLowerCase();
        stockCell = "";
      }
    }
    if (shopify) {
      kindWord = "goods";
      if (variantHandles.has(get(cells, "url handle"))) problem = "Product options need a live store connection; this import cannot preserve variants.";
    }
    if (woo) {
      const types = kindWord.split(",").map((value) => value.trim());
      if (types.some((value) => !["simple", "virtual", "downloadable"].includes(value))) problem = "Only simple WooCommerce products can be drafted here.";
      kindWord = types.includes("downloadable") ? "digital" : types.includes("virtual") ? "service" : "goods";
      if (get(cells, "sale price")) problem = "Sale pricing needs a separate review. Add this product manually.";
    }
    const kind = Object.hasOwn(KINDS, kindWord) ? KINDS[kindWord]! : "goods";
    const unitAmountMinor = priceInCurrency(price, currency);
    const stock = /^\d+$/.test(stockCell) ? Number(stockCell) : null;
    problem ??= !title ? "The name is missing." : title.length > 120 ? "The name is longer than 120 characters." : null;
    problem ??= unitAmountMinor === null ? `Enter a positive price in ${currency}, up to 100,000.` : null;
    problem ??= !Object.hasOwn(KINDS, kindWord) ? "Use goods, service or download for the type." : null;
    problem ??= stockCell && (stock === null || !Number.isSafeInteger(stock) || stock > 100_000) ? "Stock must be a whole number from 0 to 100,000." : null;
    return { line: index + (named ? 2 : 1), title, kind, unitAmountMinor, stock: kind === "goods" ? stock : null, problem };
  });
  return { format, rows };
}
