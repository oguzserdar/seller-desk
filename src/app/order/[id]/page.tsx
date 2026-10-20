import type { Metadata } from "next";
import { shopThemeStyle } from "@/lib/shop-themes";
import { getSeller } from "@/server/domain/seller";
import { OrderStatus } from "./order-status";

export const metadata: Metadata = { title: "Your order" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, seller] = await Promise.all([params, getSeller()]);
  return (
    <div className="buyer-page order-page" style={shopThemeStyle(seller?.theme)}>
      {seller ? (
        <header className="shop-header">
          <div className="min-w-0">
            <a href="/buy" className="shop-wordmark hover:underline">{seller.displayName}</a>
            <p className="shop-tagline mt-1 text-[14px]">Your order</p>
          </div>
        </header>
      ) : null}
      <main className="order-sheet">
        <OrderStatus orderId={id} />
      </main>
    </div>
  );
}
