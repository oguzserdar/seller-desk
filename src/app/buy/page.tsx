import type { Metadata } from "next";
import { ShopAssistant } from "@/components/buyer/shop-assistant";
import { Alert } from "@/components/arc/alert/alert";
import { shopThemeStyle } from "@/lib/shop-themes";
import { getSeller } from "@/server/domain/seller";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const seller = await getSeller();
  return { title: seller ? `Shop · ${seller.displayName}` : "Shop" };
}

export default async function BuyPage() {
  const seller = await getSeller();
  if (!seller) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert tone="info" title="This shop is not open yet">
          The owner has not finished setting it up.
        </Alert>
      </main>
    );
  }
  return (
    <div className="buyer-page" style={shopThemeStyle(seller.theme)}>
      <ShopAssistant entry="page" shopName={seller.displayName} />
    </div>
  );
}
