import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { requireOwner } from "@/server/auth/owner";
import { listOwnerOffers, publishBlockers } from "@/server/domain/offers";
import { OfferForm } from "../offer-form";
import { PublishToggle } from "../publish-toggle";

export const metadata: Metadata = { title: "Edit offer" };

export default async function EditOfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; saved?: string }> }) {
  const { owner, seller } = await requireOwner(await headers());
  const { id } = await params;
  const query = await searchParams;
  const created = query.created === "1";
  const found = (await listOwnerOffers(owner)).find(({ row }) => row.id === id);
  if (!found) notFound();
  const { row, stock, assetName } = found;
  const blockers = publishBlockers(seller, row, stock);
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <Link href="/owner/offers" className="text-brand text-[14px] font-semibold hover:underline">
        ← Offers
      </Link>
      <div className="mt-3 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="page-title">{row.title}</h1>
          {row.published ? <Badge tone="success">Published</Badge> : <Badge tone="neutral">Draft</Badge>}
        </div>
        <PublishToggle offerId={row.id} revision={row.revision} published={row.published} blocked={blockers.length > 0} title={row.title} />
      </div>
      {created ? (
        <Alert tone="success" className="mb-4" title={"Offer created as a draft. Publish it when it is ready for buyers."} />
      ) : null}
      {/* Shown only while the saved version is still current, so an old link never claims a later edit. */}
      {query.saved === String(row.revision) ? (
        <Alert tone="success" className="mb-4" title={`Saved as version ${row.revision}.${row.published ? " Quotes made from the previous version must be refreshed before buyers pay." : ""}`} />
      ) : null}
      {blockers.length > 0 ? (
        <Alert tone="warning" className="mb-4" title="Before buyers can see this">
          <ul className="list-disc pl-5">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {stock ? (
        <p className="text-ink-2 tabular mb-4 text-[14px]">
          Stock: {stock.total} total · {stock.held} held for checkouts in progress · {stock.sold} sold
        </p>
      ) : null}
      <OfferForm
        key={row.revision}
        currency={seller.currency}
        initial={{
          id: row.id,
          revision: row.revision,
          kind: row.kind,
          title: row.title,
          description: row.description,
          unitAmountMinor: row.unitAmountMinor,
          fulfillmentNote: row.fulfillmentNote,
          requiresScopeReview: row.requiresScopeReview,
          serviceScope: row.serviceScope ?? "",
          accessDays: row.accessDays,
          digitalAssetId: row.digitalAssetId,
          assetName,
          maxQuantity: row.maxQuantity,
          stockTotal: stock ? stock.total : null,
        }}
      />
    </section>
  );
}
