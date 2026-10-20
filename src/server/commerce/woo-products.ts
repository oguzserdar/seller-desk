import { convert } from "html-to-text";
import { z } from "zod";
import type { StoreProduct, StoreResult } from "@/lib/connected-store";
import { wooProductDestination, type WooStoreConfig } from "./woo-config";

/** Bounded native Store API search; no customer data or arbitrary filter expressions. */
export const StoreSearchInput = z.object({
  search: z.string().trim().max(120), page: z.number().int().min(1).max(100),
}).strict();
/** Search terms and explicit pagination, not an entire downloaded catalog. */
export type StoreSearchInput = z.infer<typeof StoreSearchInput>;
const PAGE_SIZE = 8;
const MAX_BYTES = 256_000;
const money = z.string().regex(/^\d{1,15}$/).refine((s) => Number.isSafeInteger(Number(s)));
const productSchema = z.object({
  id: z.number().int().positive().safe(), name: z.string().min(1).max(2000),
  description: z.string().max(100_000), short_description: z.string().max(30_000).optional(),
  permalink: z.url().max(2000), is_password_protected: z.boolean(),
  is_in_stock: z.boolean(), is_purchasable: z.boolean(), has_options: z.boolean(),
  prices: z.object({
    price: z.union([money, z.literal("")]), currency_code: z.string().regex(/^[A-Z]{3}$/),
    currency_minor_unit: z.number().int().min(0).max(6),
    price_range: z.object({ min_amount: money, max_amount: money }).nullable(),
  }),
  attributes: z.array(z.object({ name: z.string().max(300), terms: z.array(z.object({ name: z.string().max(300) })).max(100) })).max(30).optional(),
});

function plain(value: string, max: number): string {
  return convert(value, { wordwrap: false, limits: { maxInputLength: 100_000, maxDepth: 15, maxChildNodes: 200 },
    selectors: [{ selector: "a", options: { ignoreHref: true } }, { selector: "img", format: "skip" },
      { selector: "script", format: "skip" }, { selector: "style", format: "skip" }] }).replace(/\s+/g, " ").trim().slice(0, max);
}

function product(value: unknown, store: WooStoreConfig): { product: StoreProduct; destination: string } {
  const row = productSchema.parse(value);
  const destination = wooProductDestination(row.permalink, store);
  if (row.is_password_protected || !destination) throw new Error("Product is not a public page in this store");
  const prices = row.prices;
  const amount = (raw: string) => new Intl.NumberFormat("en", { style: "currency", currency: prices.currency_code,
    minimumFractionDigits: prices.currency_minor_unit, maximumFractionDigits: prices.currency_minor_unit }).format(Number(raw) / 10 ** prices.currency_minor_unit);
  if (prices.price_range && Number(prices.price_range.min_amount) > Number(prices.price_range.max_amount)) throw new Error("Invalid price range");
  const price = prices.price_range ? `${amount(prices.price_range.min_amount)}–${amount(prices.price_range.max_amount)}` : prices.price ? amount(prices.price) : "Price unavailable";
  return { destination, product: { id: row.id, title: plain(row.name, 160), description: plain(row.short_description || row.description, 1200),
    price, currency: prices.currency_code, inStock: row.is_in_stock, purchasable: row.is_purchasable,
    hasOptions: row.has_options, options: (row.attributes ?? []).slice(0, 8).map((attr) => `${plain(attr.name, 80)}: ${attr.terms.slice(0, 12).map((term) => plain(term.name, 60)).join(", ")}`) } };
}

async function read(store: WooStoreConfig, suffix: string, query: URLSearchParams, signal: AbortSignal | undefined, fetcher: typeof fetch) {
  const url = new URL(`wp-json/wc/store/v1/products${suffix}`, store.baseUrl);
  url.search = query.toString();
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetcher(url, { method: "GET", redirect: "manual", credentials: "omit", cache: "no-store",
    headers: { Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) {
    await response.body?.cancel(); throw new Error("Store did not return product data");
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) { await response.body.cancel(); throw new Error("Store response too large"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error("Store response too large");
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { data: JSON.parse(new TextDecoder().decode(bytes)) as unknown, headers: response.headers };
}

/** Fetches current public products; rejects malformed responses instead of trusting stale history. */
export async function searchWooProducts(store: WooStoreConfig, raw: StoreSearchInput, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<StoreResult> {
  const input = StoreSearchInput.parse(raw);
  const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(input.page), catalog_visibility: "visible" });
  if (input.search) query.set("search", input.search);
  const result = await read(store, "", query, signal, fetcher);
  const rows = z.array(z.unknown()).max(PAGE_SIZE).parse(result.data);
  const products: StoreProduct[] = [];
  let omitted = 0;
  for (const row of rows) {
    try { products.push(product(row, store).product); } catch { omitted++; }
  }
  if (rows.length && !products.length) throw new Error("No public product could be verified");
  const pages = Number(result.headers.get("x-wp-totalpages"));
  return { status: "ok", connection: store.connection, host: store.host, checkedAt: new Date().toISOString(), products,
    page: input.page, hasMore: pages > 0 ? pages > input.page : rows.length === PAGE_SIZE,
    message: `${omitted ? `${omitted} protected or unsupported records omitted. ` : ""}Current public store results. Options, shipping, tax, availability and final price are confirmed at the existing store checkout. These are not local Seller Desk offers.` };
}

/** Rechecks the exact product before displaying details or sending a buyer to its shop page. */
export async function readWooProduct(store: WooStoreConfig, rawId: number, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const id = z.number().int().positive().safe().parse(rawId);
  const result = await read(store, `/${id}`, new URLSearchParams(), signal, fetcher);
  const parsed = product(result.data, store);
  if (parsed.product.id !== id) throw new Error("Store returned a different product");
  return parsed;
}
