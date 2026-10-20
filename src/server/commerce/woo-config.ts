import { createHash } from "node:crypto";
import { publicShopUrl } from "@/lib/shop-guide";

/** Only the deployment operator chooses an outbound store, never model or browser input. */
export type WooStoreConfig = { baseUrl: string; host: string; connection: string };

/** Validates the WordPress installation URL; local HTTP is confined to fixture mode. */
export function parseWooStore(value: string | undefined, mode: "fixture" | "sandbox"): WooStoreConfig | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const url = new URL(raw);
  const local = mode === "fixture" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (/[\s\\\u0000-\u001f\u007f]/.test(raw) || url.username || url.password || url.search || url.hash || (!local && !publicShopUrl(raw))) {
    throw new Error("WOO_STORE_URL must be your WordPress installation's public HTTPS address, without credentials, query or fragment.");
  }
  // Restrict the configurable prefix to ordinary path segments, without encoded separators.
  if (!/^(\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname)) throw new Error("WOO_STORE_URL has an unsupported installation path.");
  const baseUrl = url.href.replace(/\/$/, "") + "/";
  return { baseUrl, host: url.host, connection: createHash("sha256").update(baseUrl).digest("hex").slice(0, 24) };
}

/** Accepts only ordinary product pages on the selected shop, never action or foreign URLs. */
export function wooProductDestination(value: string, store: WooStoreConfig): string | null {
  try {
    if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
    const url = new URL(value);
    const base = new URL(store.baseUrl);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.search || url.hash) return null;
    if (/(?:^|\/)(?:wp-admin|wp-json|wp-login\.php|wp-cron\.php)(?:\/|$)/i.test(decodeURIComponent(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}
