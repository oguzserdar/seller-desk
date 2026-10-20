import type { Metadata } from "next";
import { ShopAssistant } from "@/components/buyer/shop-assistant";
import { Alert } from "@/components/arc/alert/alert";
import { shopThemeStyle } from "@/lib/shop-themes";
import { getSeller } from "@/server/domain/seller";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop assistant" };

/** The buyer surface inside the merchant-site iframe. Framing is limited to the owner's exact origins. */
export default async function WidgetPage() {
  const seller = await getSeller();
  if (!seller) {
    return (
      <main className="p-4">
        <Alert tone="info" title={"This shop is not open yet."} />
      </main>
    );
  }
  return (
    <div className="buyer-page" style={shopThemeStyle(seller.theme)}>
      <ShopAssistant entry="widget" shopName={seller.displayName} />
    </div>
  );
}
