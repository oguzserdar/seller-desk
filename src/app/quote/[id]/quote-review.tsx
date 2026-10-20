"use client";

import { useCallback, useEffect, useState } from "react";
import { QUOTE_STATUS } from "@/components/buyer/labels";
import { OfferPhoto } from "@/components/buyer/offer-tile";
import { PaymentStatus } from "@/components/buyer/payment-status";
import { Button } from "@/components/arc/button/button";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/arc/badge/badge";
import { Alert } from "@/components/arc/alert/alert";
import { api, readToken, saveToken, takeFragmentParam } from "@/lib/buyer-client";
import { formatQuoteAmount } from "@/lib/money";
import type { PublicOffer } from "@/server/domain/offers";
import type { BuyerQuoteView } from "@/server/domain/quotes";
import type { PaymentView } from "@/server/payments/engine";

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "blocked"; message: string };
type Catalog = { offers: Pick<PublicOffer, "id" | "imagePath">[] };

/** Top-level quote review and PayPal handoff. Everything shown comes from the server's saved quote. */
export function QuoteReview({ quoteId }: { quoteId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [quote, setQuote] = useState<BuyerQuoteView | null>(null);
  const [images, setImages] = useState<Map<string, string | null>>(new Map());
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [result, catalog] = await Promise.all([api<BuyerQuoteView>(`/api/buyer/quote/${quoteId}`), api<Catalog>("/api/buyer/catalog")]);
    if (!result.data) {
      setPhase({ kind: "blocked", message: result.httpStatus === 401 ? "Open this quote from the chat where you made it." : result.message });
      return;
    }
    // The same secure handoff also opens completed orders. Only the authenticated
    // server view can supply the destination; the URL never decides paid status.
    if (result.data.order && result.data.payment?.state === "paid") {
      window.location.replace(`/order/${result.data.order.id}`);
      return;
    }
    // Photos are a nicety: without the catalog the lines show their placeholder.
    if (catalog.data) setImages(new Map(catalog.data.offers.map((offer) => [offer.id, offer.imagePath])));
    setQuote(result.data);
    if (result.data.payment) {
      const status = await api<PaymentView>(`/api/buyer/payment/${result.data.payment.attemptId}`);
      if (status.data) setPayment(status.data);
    }
    setPhase({ kind: "ready" });
  }, [quoteId]);

  useEffect(() => {
    void (async () => {
      const code = takeFragmentParam("handoff");
      if (code) {
        const exchanged = await api<{ token: string; expiresAt: string }>("/api/buyer/handoff/exchange", { method: "POST", json: { code } });
        if (!exchanged.data) {
          setPhase({ kind: "blocked", message: exchanged.message });
          return;
        }
        saveToken(exchanged.data);
      }
      if (!readToken()) {
        setPhase({ kind: "blocked", message: "Open this quote from the chat where you made it." });
        return;
      }
      await load();
    })();
  }, [load]);

  const pay = async () => {
    if (!quote) return;
    setBusy("pay");
    setMessage(null);
    const result = await api<PaymentView>("/api/buyer/checkout", { method: "POST", json: { quoteId: quote.id, revision: quote.revision } });
    if (!result.data) {
      setBusy(null);
      setMessage(result.message);
      return;
    }
    setPayment(result.data);
    if (result.data.state === "order_created" && result.data.approvalUrl) {
      window.location.assign(result.data.approvalUrl);
      return;
    }
    setBusy(null);
  };

  const cancelQuote = async () => {
    if (!quote) return;
    setBusy("cancel");
    const result = await api<BuyerQuoteView>(`/api/buyer/quote/${quote.id}/cancel`, { method: "POST", json: { revision: quote.revision } });
    setBusy(null);
    if (result.data) setQuote(result.data);
    else setMessage(result.message);
  };

  if (phase.kind === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <p role="status" className="sr-only">
          Loading your quote
        </p>
        <div className="bg-sunken h-9 w-3/4 rounded-[8px]" />
        <div className="bg-surface border-line h-64 rounded-[14px] border" />
      </div>
    );
  }
  if (phase.kind === "blocked" || !quote) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="page-title">Your quote</h1>
        <Alert tone="warning" title={phase.kind === "blocked" ? phase.message : "This quote could not be loaded."} />
        <LinkButton href="/buy" variant="secondary" className="self-start">
          Go to the shop
        </LinkButton>
      </div>
    );
  }

  const status = QUOTE_STATUS[quote.status] ?? { label: quote.status, tone: "neutral" as const };
  const kinds = new Set(quote.lines.map((line) => line.kind));
  const terms: { title: string; text: string | null }[] = [
    ...(kinds.has("goods") ? [{ title: "Pickup", text: quote.policy.pickupPolicy }] : []),
    ...(kinds.has("service") ? [{ title: "Service request", text: quote.policy.serviceRequestPolicy }] : []),
    ...(kinds.has("digital") ? [{ title: "Download access", text: quote.policy.digitalAccessPolicy }] : []),
    { title: "Cancellation", text: quote.policy.cancellationPolicy },
    { title: "Tax", text: quote.policy.taxPolicy },
  ];
  const payable = quote.status === "review_ready" && quote.isLatest && !payment;
  const cancellable = quote.isLatest && ["review_ready", "needs_information", "seller_review"].includes(quote.status) && !payment;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="page-title">You are paying {quote.policy.sellerName}</h1>
        <p className="text-ink-2 mt-1.5 text-[16px]">{payable ? "Check the order, then approve the payment in PayPal." : "Here is your order as the shop priced it."}</p>
      </header>

      {!quote.isLatest ? (
        <Alert tone="warning" title="This quote was updated">
          <a className="font-semibold underline" href={`/quote/${quote.latestQuoteId}`}>
            Open the latest quote
          </a>
        </Alert>
      ) : null}

      <section aria-label="Your order" className="bg-surface border-line rounded-[14px] border">
        {payable ? null : (
          <div className="flex justify-end px-5 pt-4">
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        )}
        <ul className="divide-line divide-y px-5">
          {quote.lines.map((line) => (
            <li key={line.offerId} className="flex items-center gap-4 py-4">
              <OfferPhoto offer={{ title: line.title, imagePath: images.get(line.offerId) ?? null }} sizes="56px" className="size-14 shrink-0 rounded-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {line.title}
                  {line.quantity > 1 ? <span className="text-ink-3 font-medium"> × {line.quantity}</span> : null}
                </p>
                {line.fulfillmentNote ? <p className="text-ink-3 text-[14px]">{line.fulfillmentNote}</p> : null}
              </div>
              <span className="tabular shrink-0 font-semibold">{formatQuoteAmount(line.lineTotalMinor, quote.currency)}</span>
            </li>
          ))}
        </ul>
        {quote.charges.length > 0 ? (
          <dl className="border-line text-ink-2 flex flex-col gap-1 border-t px-5 py-3 text-[15px]">
            {quote.charges.map((charge) => (
              <div key={charge.code} className="flex justify-between gap-4">
                <dt>{charge.label}</dt>
                <dd className="tabular">{charge.amountMinor === 0 ? "No charge" : formatQuoteAmount(charge.amountMinor, quote.currency)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="border-line flex items-baseline justify-between border-t px-5 py-4">
          <span className="font-semibold">Total</span>
          <span className="tabular text-[26px] font-semibold tracking-[-0.02em]">
            {formatQuoteAmount(quote.totalMinor, quote.currency)} <span className="text-ink-3 text-[14px] font-medium tracking-normal">{quote.currency}</span>
          </span>
        </div>
      </section>

      {quote.approvedScope ? (
        <Alert tone="info" title="The shop confirmed the work">
          {quote.approvedScope}
        </Alert>
      ) : null}
      {quote.unresolved.map((item) => (
        <Alert key={`${item.code}-${item.offerId ?? ""}`} tone="warning" title={item.message} />
      ))}
      {quote.status === "seller_review" ? (
        <Alert tone="warning" title="The shop is checking this request">
          {quote.reviewReason} Reload this page after they reply. Nothing is charged before you approve.
        </Alert>
      ) : null}
      {message ? <Alert tone="danger" title={message} /> : null}
      {payment ? <PaymentStatus view={payment} onChange={setPayment} orderHref={quote.order ? `/order/${quote.order.id}` : null} /> : null}

      <details className="text-[15px]">
        <summary className="text-ink-2 hover:text-ink cursor-pointer font-medium select-none">Terms you agree to by paying</summary>
        <dl className="mt-3 flex flex-col gap-3">
          {terms.map((term) => (
            <div key={term.title}>
              <dt className="font-medium">{term.title}</dt>
              <dd className="text-ink-2">{term.text ?? "Not set by the shop."}</dd>
            </div>
          ))}
        </dl>
      </details>

      {payable ? (
        <div className="flex flex-col gap-2">
          <Button onClick={() => void pay()} loading={busy === "pay"} className="w-full sm:w-auto sm:min-w-72 sm:self-start">
            Pay {formatQuoteAmount(quote.totalMinor, quote.currency)} with PayPal
          </Button>
          <p className="text-ink-3 text-[13px]">
            You approve the payment inside PayPal. {quote.policy.sellerName} sees your order only after PayPal confirms it.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <LinkButton href="/buy" variant="secondary">
          Back to the shop
        </LinkButton>
        {cancellable ? (
          <Button variant="ghost" onClick={() => void cancelQuote()} loading={busy === "cancel"}>
            Cancel quote
          </Button>
        ) : null}
      </div>
    </div>
  );
}
