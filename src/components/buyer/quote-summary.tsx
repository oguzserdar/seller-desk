"use client";

import type { ReactNode } from "react";
import { useId } from "react";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";
import { Alert } from "@/components/arc/alert/alert";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatQuoteAmount } from "@/lib/money";
import type { BuyerQuoteView } from "@/server/domain/quotes";
import { QUOTE_STATUS } from "./labels";
import { OfferPhoto } from "./offer-tile";
import type { QuoteBusy, QuoteFix } from "./use-buyer-quote";

type Props = {
  quote: BuyerQuoteView | null;
  imageFor: (offerId: string) => string | null;
  limitFor: (offerId: string) => number;
  busy: QuoteBusy;
  error: string | null;
  payLabel: string;
  payReady: boolean;
  onQuantity: (offerId: string, quantity: number) => void;
  onPay: () => void;
  onReviewPayment: () => void;
  onFix: (fix: QuoteFix) => void;
  onStartOver: () => void;
  className?: string;
  /** Where the purchase stands, shown right after the total. */
  standing?: ReactNode;
  /** False inside a sheet whose own title already names the quote. */
  titled?: boolean;
  /** The assistant collects the job details in the chat, so the panel shows them instead of a form. */
  describeInChat?: boolean;
};

function Stepper({
  title,
  quantity,
  max,
  disabled,
  onChange,
}: {
  title: string;
  quantity: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onChange(quantity - 1)}
        aria-label={quantity === 1 ? `Remove ${title}` : `One fewer ${title}`}
      >
        <Minus aria-hidden size={15} strokeWidth={2} />
      </Button>
      <span
        className="tabular w-5 text-center text-[15px] font-semibold"
        aria-label={`Quantity ${quantity}`}
      >
        {quantity}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || quantity >= max}
        onClick={() => onChange(quantity + 1)}
        aria-label={`One more ${title}`}
      >
        <Plus aria-hidden size={15} strokeWidth={2} />
      </Button>
    </div>
  );
}

/** The server-priced quote, or the existing order and receipt action once payment is verified. */
export function QuoteSummary({
  quote,
  imageFor,
  limitFor,
  busy,
  error,
  payLabel,
  payReady,
  onQuantity,
  onPay,
  onReviewPayment,
  onFix,
  onStartOver,
  className,
  standing,
  titled = true,
  describeInChat = false,
}: Props) {
  const detailsId = useId();
  if (!quote) {
    return (
      <section
        aria-label="Your quote"
        className={cx("quote-summary bg-surface p-5", className)}
      >
        {titled ? <h2 className="mb-3 text-[17px] font-semibold">Your quote</h2> : null}
        <p className="border-line-strong text-ink-2 rounded-[10px] border border-dashed px-4 py-5 text-center text-[14px]">
          Your quote is empty. Items you add appear here, with the total before
          you pay.
        </p>
        {error ? <Alert tone="danger" className="mt-3" title={error} /> : null}
      </section>
    );
  }

  const open =
    quote.isLatest &&
    ["review_ready", "needs_information", "seller_review"].includes(
      quote.status,
    );
  const payable =
    quote.status === "review_ready" && quote.isLatest && !quote.payment;
  const overBudget = quote.unresolved.find(
    (item) => item.code === "over_budget",
  );
  const kinds = new Set(quote.lines.map((line) => line.kind));
  // "review_ready" means payable: a fixed-price service is ready at once, a scoped one only after the shop
  // approves the work. Either way paying is the next step and changing the work is the exception.
  const priced = quote.status === "review_ready";
  const serviceEditor = (
    <form
      key={quote.id}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const buyerNote = String(
          new FormData(event.currentTarget).get("buyerNote") ?? "",
        ).trim();
        if (buyerNote.length >= 3) onFix({ kind: "details", buyerNote });
      }}
    >
      <Textarea
        label="Describe the work"
        description="Include what you need and any constraints. Changing the work or quantity requires a new seller review."
        id={detailsId}
        name="buyerNote"
        rows={3}
        maxLength={1000}
        minLength={3}
        required
        defaultValue={quote.buyerNote ?? ""}
      />
      <Button variant="secondary" type="submit" loading={busy === "quote"}>
        {quote.buyerNote ? "Update request" : "Send request to seller"}
      </Button>
    </form>
  );
  const terms = [
    kinds.has("goods")
      ? { title: "Pickup", text: quote.policy.pickupPolicy }
      : null,
    kinds.has("service")
      ? { title: "Service", text: quote.policy.serviceRequestPolicy }
      : null,
    kinds.has("digital")
      ? { title: "Download", text: quote.policy.digitalAccessPolicy }
      : null,
    { title: "Cancellation", text: quote.policy.cancellationPolicy },
    { title: "Tax", text: quote.policy.taxPolicy },
  ].filter((term): term is { title: string; text: string } =>
    Boolean(term?.text),
  );

  return (
    <section
      aria-label={quote.order ? "Your purchase" : "Your quote"}
      className={cx("quote-summary bg-surface", className)}
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-1">
        {titled ? (
          <h2 className="text-[17px] font-semibold">
            {quote.order ? `Order #${quote.order.number}` : "Your quote"}
          </h2>
        ) : null}
        {quote.order ? (
          <span
            role="status"
            className="bg-success-soft text-success inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
          >
            <CheckCircle2 aria-hidden size={14} />
            Paid
          </span>
        ) : (
          <span
            className={cx(
              "text-[13px] font-semibold",
              quote.status === "needs_information" ||
                quote.status === "seller_review"
                ? "text-attention"
                : "text-ink-3",
            )}
          >
            {QUOTE_STATUS[quote.status]?.label ?? quote.status}
          </span>
        )}
      </div>
      {quote.order ? (
        <div className="border-line border-b px-5 pt-2 pb-4">
          <Button
            variant="secondary"
            className="min-h-10 w-full"
            onClick={onReviewPayment}
            loading={!payReady}
          >
            View your order
          </Button>
        </div>
      ) : null}
      <ul className="px-5" aria-label="Items">
        {quote.lines.map((line) => {
          // A one-off repair (limit 1) has no quantity to choose; changing it would need a new review anyway.
          const stepper =
            open && (limitFor(line.offerId) > 1 || line.quantity > 1);
          return (
            <li
              key={line.offerId}
              className="enter border-line flex gap-3 border-b py-3.5 last:border-b-0"
            >
              <OfferPhoto
                offer={{ title: line.title, imagePath: imageFor(line.offerId) }}
                sizes="56px"
                className="size-14 shrink-0 rounded-[10px]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] leading-snug font-medium">
                    {line.title}
                  </p>
                  {/* Unpriced lines say "Price set by the seller" below; the total row carries the waiting state. */}
                  {line.lineTotalMinor === null ? null : (
                    <p className="tabular text-[15px] font-semibold">
                      {formatQuoteAmount(line.lineTotalMinor, quote.currency)}
                    </p>
                  )}
                </div>
                {stepper ||
                line.quantity > 1 ||
                line.unitAmountMinor === null ? (
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <p className="text-ink-3 tabular text-[13px]">
                      {line.unitAmountMinor === null
                        ? "Price set by the seller"
                        : `${formatQuoteAmount(line.unitAmountMinor, quote.currency)} each`}
                    </p>
                    {stepper ? (
                      <Stepper
                        title={line.title}
                        quantity={line.quantity}
                        max={limitFor(line.offerId)}
                        disabled={busy !== null}
                        onChange={(next) => onQuantity(line.offerId, next)}
                      />
                    ) : (
                      <span className="text-ink-3 text-[13px]">
                        x {line.quantity}
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {/* After payment a zero charge only restates the ladder below; the order keeps it in its record. */}
      {quote.charges.some(
        (charge) => !quote.order || charge.amountMinor !== 0,
      ) ? (
        <ul
          className="border-line text-ink-2 border-t px-5 py-2"
          aria-label="Charges"
        >
          {quote.charges
            .filter((charge) => !quote.order || charge.amountMinor !== 0)
            .map((charge) => (
              <li
                key={charge.code}
                className="flex justify-between gap-4 py-1 text-[14px]"
              >
                <span>{charge.label}</span>
                <span className="tabular whitespace-nowrap">
                  {charge.amountMinor === 0
                    ? "No charge"
                    : formatQuoteAmount(charge.amountMinor, quote.currency)}
                </span>
              </li>
            ))}
        </ul>
      ) : null}
      <div className="border-line flex items-baseline justify-between border-t px-5 py-3.5">
        <span className="text-[15px] font-semibold">Total</span>
        <span className="tabular text-[22px] font-semibold tracking-[-0.01em]">
          {formatQuoteAmount(quote.totalMinor, quote.currency)}{" "}
          <span className="text-ink-3 text-[13px] font-medium tracking-normal">
            {quote.currency}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-3 px-5 pb-5">
        {standing}
        {quote.unresolved.map((item) => (
          <Alert
            key={`${item.code}-${item.offerId ?? ""}`}
            tone="warning"
            title={item.message}
          >
            {item.code === "delivery_not_offered" ? (
              <Button
                type="button"
                variant="ghost"
                className="mt-1"
                onClick={() => onFix({ kind: "pickup" })}
              >
                Switch to pickup
              </Button>
            ) : null}
          </Alert>
        ))}
        {overBudget && quote.totalMinor !== null ? (
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              onFix({ kind: "raise_budget", budgetMinor: quote.totalMinor! })
            }
          >
            Raise my budget to{" "}
            {formatQuoteAmount(quote.totalMinor, quote.currency)}
          </Button>
        ) : null}
        {open && kinds.has("service") && !priced ? (
          describeInChat ? (
            <div className="text-[14px]">
              {quote.buyerNote ? (
                <>
                  <p className="text-ink-3 text-[13px] font-medium">Sent to the shop</p>
                  <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{quote.buyerNote}</p>
                </>
              ) : (
                <p className="text-ink-2">Tell the assistant about the job. It sends the request to the shop.</p>
              )}
            </div>
          ) : (
            serviceEditor
          )
        ) : null}
        {quote.status === "seller_review" ? (
          <Alert tone="info" title="The shop prices this work first">
            {quote.reviewReason} You will see the confirmed quote here. Nothing
            is charged before you approve it.
          </Alert>
        ) : null}
        {quote.approvedScope ? (
          <div>
            <p className="text-ink-3 text-[13px] font-medium">
              {quote.order ? "Purchased work" : "Confirmed by the shop"}
            </p>
            <p className="text-ink-2 mt-1 text-[14px] leading-relaxed">
              {quote.approvedScope}
            </p>
          </div>
        ) : null}
        {quote.payment && !quote.order ? (
          <div role="status" aria-live="polite">
            <Alert tone="info" title="Check your payment">
              <p>See whether your payment needs approval or has finished.</p>
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={onReviewPayment}
                loading={!payReady}
              >
                Check payment status
              </Button>
            </Alert>
          </div>
        ) : null}
        {quote.status === "expired" ? (
          <Alert
            tone="info"
            title={
              "This quote expired. Change anything to get a fresh one; prices are checked again."
            }
          />
        ) : null}
        {error ? <Alert tone="danger" title={error} /> : null}
        {payable ? (
          <div className="quote-pay flex flex-col gap-2">
            <Button
              className="min-h-12 w-full text-[16px]"
              onClick={onPay}
              loading={busy === "pay" || !payReady}
              disabled={busy === "quote"}
            >
              {payLabel}
            </Button>
            <p className="text-ink-2 text-center text-[13px]">
              You approve the payment in PayPal. Nothing is charged before that.
            </p>
          </div>
        ) : null}
        {open && kinds.has("service") && priced && !describeInChat ? (
          <details className="text-[14px]">
            <summary className="text-ink-2 hover:text-ink min-h-11 cursor-pointer py-2.5 font-medium select-none">
              Change the work
            </summary>
            <div className="mt-2">{serviceEditor}</div>
          </details>
        ) : null}
        {terms.length > 0 ? (
          <details className="group/terms text-[14px]">
            <summary className="text-ink-2 hover:text-ink min-h-11 cursor-pointer py-2.5 font-medium select-none">
              The shop&apos;s terms
            </summary>
            <dl className="text-ink-2 mt-2 flex flex-col gap-2">
              {terms.map((term) => (
                <div key={term.title}>
                  <dt className="text-ink font-semibold">{term.title}</dt>
                  <dd>{term.text}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <p className="text-ink-3 flex items-center justify-between gap-3 text-[13px]">
          <span>
            {open || quote.status === "expired"
              ? `Valid until ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : null}
          </span>
          <Button type="button" variant="ghost" onClick={onStartOver}>
            Start over
          </Button>
        </p>
      </div>
    </section>
  );
}
