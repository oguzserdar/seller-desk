/** Public facts from an existing store, never local offers or payment authority. */
export type StoreProduct = {
  id: number;
  title: string;
  description: string;
  price: string;
  currency: string;
  inStock: boolean;
  purchasable: boolean;
  hasOptions: boolean;
  options: string[];
};

/** A fresh bounded read, including explicit failure instead of stale stock. */
export type StoreResult = {
  status: "ok" | "unavailable" | "disconnected";
  connection: string | null;
  host: string | null;
  checkedAt: string | null;
  products: StoreProduct[];
  page: number;
  hasMore: boolean;
  message: string;
};

/** Stable internal link; the server resolves and checks the destination on click. */
export function storeProductHref(connection: string, productId: number): string {
  return `/store-product/${productId}?connection=${encodeURIComponent(connection)}`;
}
