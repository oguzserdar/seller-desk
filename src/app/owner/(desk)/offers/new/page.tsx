import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { requireOwner } from "@/server/auth/owner";
import { OfferForm } from "../offer-form";

export const metadata: Metadata = { title: "New offer" };

export default async function NewOfferPage() {
  const { seller } = await requireOwner(await headers());
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <Link href="/owner/offers" className="text-brand text-[14px] font-semibold hover:underline">
        ← Offers
      </Link>
      <h1 className="page-title mt-3 mb-5">New offer</h1>
      <OfferForm
        currency={seller.currency}
        initial={{
          kind: "goods",
          title: "",
          description: "",
          unitAmountMinor: null,
          fulfillmentNote: "",
          requiresScopeReview: false,
          serviceScope: "",
          accessDays: null,
          digitalAssetId: null,
          assetName: null,
          maxQuantity: 1,
          stockTotal: 1,
        }}
      />
    </section>
  );
}
