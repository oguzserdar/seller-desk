import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { formatQuoteAmount } from "@/lib/money";
import { requireOwner } from "@/server/auth/owner";
import { listOwnerOffers, publishBlockers } from "@/server/domain/offers";
import { PublishToggle } from "./publish-toggle";

export const metadata: Metadata = { title: "Offers" };

const KIND: Record<string, string> = { goods: "Pickup item", service: "Service", digital: "Download" };

/** Shows the owner's catalog, publication requirements and import entry. */
export default async function OffersPage() {
  const { owner, seller, viewer } = await requireOwner(await headers());
  const offers = await listOwnerOffers(owner);
  const published = offers.filter(({ row }) => row.published).length;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Offers</h1>
          <p className="text-ink-2 mt-1">
            {published} of {offers.length} published. Buyers see published offers only; fixed prices and your reviewed custom quotes are the only prices the assistant can use.
          </p>
        </div>
        {/* A demo visitor browses the catalog; adding and importing are the owner's. */}
        {viewer ? null : (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/owner/offers/import" variant="secondary">
              Import offers
            </LinkButton>
            <LinkButton href="/owner/offers/new">New offer</LinkButton>
          </div>
        )}
      </div>
      {offers.length === 0 ? (
        <Alert tone="info" className="mt-6" title="No offers yet">
          Add your first offer, or paste a price list and review the drafts.
        </Alert>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {offers.map(({ row, stock, assetName }) => {
            const blockers = publishBlockers(seller, row, stock);
            const available = stock ? stock.total - stock.held - stock.sold : null;
            return (
              <li key={row.id}>
                <section className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <OfferPhoto offer={{ title: row.title, imagePath: row.imagePath, kind: row.kind }} sizes="64px" className="size-16 shrink-0 rounded-[10px]" />
                    <div className="min-w-0">
                    <Link href={`/owner/offers/${row.id}`} className="block text-[17px] font-semibold hover:underline">
                      {row.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {row.published ? <Badge tone="success">Published</Badge> : <Badge tone="neutral">Draft</Badge>}
                      <span className="text-ink-3 text-[14px]">{KIND[row.kind]}</span>
                      {row.requiresScopeReview ? <Badge tone="neutral">You confirm the work first</Badge> : null}
                    </div>
                    <p className="text-ink-2 tabular mt-1 text-[14px]">
                      {row.unitAmountMinor === null ? "Quoted per job" : formatQuoteAmount(row.unitAmountMinor, row.currency)}
                      {stock ? `, ${available} available, ${stock.held} held for checkouts, ${stock.sold} sold` : ""}
                      {row.kind === "digital" ? `, ${assetName ?? "no file yet"}, access for ${row.accessDays ?? "?"} days` : ""}
                    </p>
                    {blockers.length > 0 && !row.published ? (
                      <p className="text-attention mt-1 text-[13px]">Before publishing: {blockers.join(" ")}</p>
                    ) : null}
                    </div>
                  </div>
                  {/* On a phone the actions sit under the text column, not under the photo. */}
                  <div className="flex shrink-0 items-center gap-2 pl-20 sm:pl-0">
                    <LinkButton href={`/owner/offers/${row.id}`} variant="secondary">
                      {viewer ? "View" : "Edit"}
                    </LinkButton>
                    {viewer ? null : <PublishToggle offerId={row.id} revision={row.revision} published={row.published} blocked={blockers.length > 0} title={row.title} />}
                  </div>
                </section>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
