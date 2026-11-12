import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { formatQuoteAmount } from "@/lib/money";
import { ownerQuoteTitle } from "@/lib/quote-status";
import { requireOwner } from "@/server/auth/owner";
import { DomainError } from "@/server/domain/errors";
import { readOwnerQuoteReview } from "@/server/domain/owner-quote";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScopeReview } from "./scope-review";

export const metadata: Metadata = { title: "Review quote" };

/** Where a quote stands, in the owner's words. */
const OWNER_QUOTE_STATUS: Record<string, string> = {
  seller_review: "Waiting for you",
  review_ready: "Sent to the customer",
  needs_information: "Needs a change",
  accepted: "Customer is paying",
  consumed: "Paid",
  expired: "Expired",
  replaced: "Replaced by a newer quote",
  cancelled: "Cancelled",
};

export default async function OwnerQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { owner } = await requireOwner(await headers());
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await readOwnerQuoteReview(owner, id).catch((error) => {
    if (error instanceof DomainError && error.code === "not_found") return null;
    throw error;
  });
  if (!detail) notFound();
  const { row, status, pendingQuestion, serviceLine, serviceOffer } = detail;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <Link
        href="/owner/orders?view=quotes_awaiting_review"
        className="text-brand text-[14px] font-semibold hover:underline"
      >
        ← Quotes to review
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">
          {ownerQuoteTitle({
            status,
            totalMinor: row.totalMinor,
            hasService: Boolean(serviceLine),
          })}
        </h1>
        <Badge tone={status === "seller_review" ? "warning" : "neutral"}>
          {OWNER_QUOTE_STATUS[status] ?? status}
        </Badge>
      </div>
      <section className="surface mt-5 p-5">
        <ul className="flex flex-col gap-1.5 text-[15px]">
          {row.lines.map((line) => (
            <li key={line.offerId} className="flex justify-between gap-4">
              <span>
                {line.quantity} × {line.title}
              </span>
              <span className="tabular">
                {formatQuoteAmount(line.lineTotalMinor, row.currency)}
              </span>
            </li>
          ))}
        </ul>
        <p className="tabular mt-3 font-semibold">
          Total {formatQuoteAmount(row.totalMinor, row.currency)}
        </p>
        {row.buyerNote ? (
          <Alert tone="info" title="What the customer told you" className="mt-4">
            {row.buyerNote}
          </Alert>
        ) : (
          <p className="text-ink-3 mt-3 text-[14px]">
            The buyer did not add details.
          </p>
        )}
      </section>
      {row.approvedScope ? (
        <Alert tone="info" title="Your confirmed scope" className="mt-5">
          {row.approvedScope}
        </Alert>
      ) : null}
      {status === "seller_review" ? (
        <ScopeReview
          quoteId={row.id}
          revision={row.revision}
          defaultScope={serviceOffer?.scope ?? ""}
          currency={row.currency}
          pendingQuestion={pendingQuestion}
          lines={row.lines.map(
            ({ offerId, title, quantity, unitAmountMinor }) => ({
              offerId,
              title,
              quantity,
              unitAmountMinor,
            }),
          )}
        />
      ) : (
        <Alert
          tone="info"
          className="mt-5"
          title={"This quote no longer needs your review."}
        />
      )}
    </section>
  );
}
