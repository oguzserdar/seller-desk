import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { StoreProducts } from "@/components/buyer/store-products";
import { Thread } from "@/components/buyer/thread";
import { parseWooStore, wooProductDestination } from "@/server/commerce/woo-config";
import { readWooProduct, searchWooProducts, StoreSearchInput } from "@/server/commerce/woo-products";
import { connectedStoreTools } from "@/server/ai/connected-store-tools";
import { parseServerConfig, resetServerConfigForTests } from "@/server/env";
import { GET } from "../../src/app/store-product/[id]/route";
import { newBuyer, resetShop, tally } from "../support/shop";
import { TEST_ENV } from "../support/test-env";

const STORE = parseWooStore("https://shop.example.com/wordpress", "sandbox")!;
const row = (extra: Record<string, unknown> = {}) => ({
  id: 81, name: "Canvas &amp; leather bag", description: "<p>Fits a 13-inch laptop.</p>", short_description: "",
  permalink: "https://shop.example.com/wordpress/product/bag/", is_password_protected: false,
  is_in_stock: true, is_purchasable: true, has_options: false,
  prices: { price: "4800", currency_code: "CAD", currency_minor_unit: 2, price_range: null }, ...extra,
});
const reply = (data: unknown, headers = {}) => Response.json(data, { headers });
const options = { toolCallId: "store-check", messages: [], context: {} };

describe("existing WooCommerce public store", () => {
  beforeEach(async () => { await resetShop(); delete process.env.WOO_STORE_URL; resetServerConfigForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.WOO_STORE_URL; resetServerConfigForTests(); });

  it("only permits a deployment-selected HTTPS installation, with loopback confined to fixture mode", () => {
    expect(parseWooStore(undefined, "sandbox")).toBeNull();
    expect(STORE.baseUrl).toBe("https://shop.example.com/wordpress/");
    expect(parseWooStore(STORE.baseUrl, "sandbox")?.connection).toBe(STORE.connection);
    for (const url of ["http://shop.example.com", "https://user:pass@shop.example.com", "https://shop.example.com/?a=b", "https://127.0.0.1", "http://localhost:4457", "https://shop.internal", "https://shop.example.com/a%2fb", "https://shop.example.com\\@attacker.com"]) {
      expect(() => parseWooStore(url, "sandbox"), url).toThrow();
    }
    expect(parseWooStore("http://127.0.0.1:4457", "fixture")?.baseUrl).toBe("http://127.0.0.1:4457/");
    expect(() => parseServerConfig({ ...TEST_ENV, WOO_STORE_URL: "https://user:pass@shop.example.com" })).toThrow("WOO_STORE_URL");
  });

  it("uses a fixed GET endpoint, bounded encoded search and explicit pagination without credentials or redirects", async () => {
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => reply([row()], { "x-wp-totalpages": "4" }));
    const result = await searchWooProducts(STORE, { search: "bag&per_page=100", page: 2 }, undefined, fetcher);
    const [target, init] = fetcher.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin + url.pathname).toBe("https://shop.example.com/wordpress/wp-json/wc/store/v1/products");
    expect(Object.fromEntries(url.searchParams)).toEqual({ search: "bag&per_page=100", per_page: "8", page: "2", catalog_visibility: "visible" });
    expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } });
    expect(result).toMatchObject({ page: 2, hasMore: true, products: [{ id: 81, title: "Canvas & leather bag", price: "CA$48.00" }] });
    expect(result.products[0]).not.toHaveProperty("permalink");
    expect(StoreSearchInput.safeParse({ search: "bag", page: 1, url: "https://attacker.com" }).success).toBe(false);
    expect(StoreSearchInput.safeParse({ search: "x".repeat(121), page: 1 }).success).toBe(false);
  });

  it("preserves variable price ranges and currency precision without inventing exact stock quantities", async () => {
    const product = row({ has_options: true, is_in_stock: false, attributes: [{ name: "Colour", terms: [{ name: "Moss" }, { name: "Black" }] }],
      prices: { price: "6500", currency_code: "JPY", currency_minor_unit: 0, price_range: { min_amount: "6500", max_amount: "7000" } } });
    const result = await searchWooProducts(STORE, { search: "", page: 1 }, undefined, async () => reply([product]));
    expect(result.products[0]).toMatchObject({ price: "¥6,500–¥7,000", hasOptions: true, inStock: false, options: ["Colour: Moss, Black"] });
    expect(result.products[0]).not.toHaveProperty("quantity");
  });

  it("removes remote HTML, image loads and link destinations before rendering or model input", async () => {
    const result = await searchWooProducts(STORE, { search: "", page: 1 }, undefined, async () => reply([row({
      name: "<script>alert(1)</script>Canvas &amp; leather", description: '<p>Dry bag</p><img src="https://tracker.com/secret"><a href="javascript:alert(1)">Care instructions</a>',
    })]));
    expect(result.products[0]?.title).toBe("Canvas & leather");
    expect(result.products[0]?.description).toBe("Dry bag Care instructions");
    const html = renderToStaticMarkup(createElement(StoreProducts, { result }));
    expect(html).not.toMatch(/<script|<img|javascript:|tracker\.com/);
    expect(html).toContain(`/store-product/81?connection=${STORE.connection}`);
    expect(html).toContain("Final options, shipping and total");
    expect(html).not.toContain("Add to quote");
  });

  it("refuses protected products, malformed prices, foreign links and action URLs", async () => {
    for (const bad of [row({ is_password_protected: true }), row({ permalink: "https://attacker.com/product/81" }),
      row({ permalink: "https://shop.example.com/wordpress/?add-to-cart=81" }), row({ prices: { price: "-5", currency_code: "CAD", currency_minor_unit: 2, price_range: null } })]) {
      await expect(readWooProduct(STORE, 81, undefined, async () => reply(bad))).rejects.toThrow();
    }
    for (const url of ["https://shop.example.com/wordpress/wp-admin/", "https://shop.example.com/wordpress/wp-json/products", "https://shop.example.com/wordpress/../wp-admin/", "https://other.example.com/product/81", "https://shop.example.com/elsewhere/product/81"]) {
      expect(wooProductDestination(url, STORE)).toBeNull();
    }
    await expect(readWooProduct(STORE, 81, undefined, async () => reply(row({ id: 82 })))).rejects.toThrow("different product");
  });

  it("shows the selected product once when the model searches and then checks its details", async () => {
    const result = await searchWooProducts(STORE, { search: "bag", page: 1 }, undefined, async () => reply([row()]));
    const messages: UIMessage[] = [{ id: "store-answer", role: "assistant", parts: [
      { type: "tool-search_store_products", toolCallId: "search", state: "output-available", input: { search: "bag", page: 1 }, output: result },
      { type: "tool-read_store_product", toolCallId: "read", state: "output-available", input: { productId: 81 }, output: result },
    ] }];
    const html = renderToStaticMarkup(createElement(Thread, { widget: false, messages, status: "ready", shopName: "Test shop", inQuote: () => false,
      quoteBusy: false, onAdd: () => {}, onViewQuote: () => {}, error: null, onRetry: () => {} }));
    expect(html.match(/View in the shop/g)).toHaveLength(1);
    expect(html).toContain("Checked shop.example.com: 1 product");
  });

  it("rejects redirected, oversized, malformed and non-JSON responses without a second request", async () => {
    for (const response of [new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
      new Response("<html>error</html>", { headers: { "content-type": "text/html" } }),
      new Response("x".repeat(256_001), { headers: { "content-type": "application/json" } }),
      reply([row()], { "content-length": "256001" }), reply(Array.from({ length: 9 }, () => row()))]) {
      const fetcher = vi.fn(async () => response);
      await expect(searchWooProducts(STORE, { search: "", page: 1 }, undefined, fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("passes caller cancellation to the transport", async () => {
    const control = new AbortController(); control.abort();
    const fetcher: typeof fetch = async (_url, init) => { expect(init?.signal?.aborted).toBe(true); throw init?.signal?.reason; };
    await expect(searchWooProducts(STORE, { search: "", page: 1 }, control.signal, fetcher)).rejects.toThrow();
  });

  it("checks the current store again when price or stock changes; failures never return stale product facts", async () => {
    process.env.WOO_STORE_URL = STORE.baseUrl; resetServerConfigForTests();
    const buyer = await newBuyer(); const tools = connectedStoreTools(buyer);
    const fetcher = vi.fn().mockResolvedValueOnce(reply([row()])).mockResolvedValueOnce(reply([row({ is_in_stock: false })])).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const before = await tally();
    expect(await tools.search_store_products.execute!({ search: "bag", page: 1 }, options)).toMatchObject({ products: [{ inStock: true }] });
    expect(await tools.search_store_products.execute!({ search: "bag", page: 1 }, options)).toMatchObject({ products: [{ inStock: false }] });
    expect(await tools.search_store_products.execute!({ search: "bag", page: 1 }, options)).toMatchObject({ status: "unavailable", products: [], checkedAt: null });
    expect(await tally()).toEqual(before);
  });

  it("does not fetch for a disconnected or foreign shop", async () => {
    const buyer = await newBuyer(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await connectedStoreTools(buyer).search_store_products.execute!({ search: "bag", page: 1 }, options)).toMatchObject({ status: "disconnected" });
    process.env.WOO_STORE_URL = STORE.baseUrl; resetServerConfigForTests();
    await expect(connectedStoreTools({ ...buyer, sellerId: crypto.randomUUID() }).read_store_product.execute!({ productId: 81 }, options)).rejects.toMatchObject({ code: "not_found" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rechecks product links and refuses historical links for a replaced store connection", async () => {
    process.env.WOO_STORE_URL = STORE.baseUrl; resetServerConfigForTests();
    const fetcher = vi.fn().mockResolvedValueOnce(reply(row())).mockResolvedValueOnce(reply(row({ permalink: "https://attacker.com" })));
    vi.stubGlobal("fetch", fetcher);
    const request = () => new Request(`http://localhost/store-product/81?connection=${STORE.connection}&url=https://attacker.com`);
    const context = { params: Promise.resolve({ id: "81" }) };
    const good = await GET(request(), context);
    expect(good.status).toBe(302); expect(good.headers.get("Location")).toBe(row().permalink);
    expect(good.headers.get("Cache-Control")).toBe("no-store"); expect(good.headers.get("Referrer-Policy")).toBe("no-referrer");
    const changed = await GET(request(), context);
    expect(changed.headers.get("Location")).toBe("/store-product/unavailable");
    process.env.WOO_STORE_URL = "https://other.example.com"; resetServerConfigForTests();
    expect((await GET(request(), context)).status).toBe(303);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
