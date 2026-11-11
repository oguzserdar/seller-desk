import type { Metadata } from "next";
import { ShopAssistant } from "@/components/buyer/shop-assistant";
import { Alert } from "@/components/arc/alert/alert";
import { shopThemeStyle } from "@/lib/shop-themes";
import { getSeller } from "@/server/domain/seller";
import { getServerConfig } from "@/server/env";

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
      <ShopAssistant
        entry="page"
        shopName={seller.displayName}
        // The public demo says plainly what this shop is, so a first-time visitor is not guessing.
        demoIntro={
          getServerConfig().publicDemo
            ? `${seller.displayName} is a small bike repair shop, made up to show Seller Desk. Ask what a customer would ask: a repair, a part, a price. Payments run in the PayPal sandbox, so no real money moves.`
            : undefined
        }
      />
    </div>
  );
}
