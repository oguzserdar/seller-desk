"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/arc/card/card";
import { Button } from "@/components/arc/button/button";
import { Check, Plus } from "lucide-react";
import { formatQuoteAmount } from "@/lib/money";
import type { PublicOffer } from "@/server/domain/offers";
import { OFFER_CARD_CLASS, OfferMedia } from "./offer-tile";

/**
 * Starter questions drawn from what this shop actually sells, phrased the way a customer would ask
 * this shop: a booking for a priced service, a budget, then a quote or a download.
 */
export function suggestionsFor(offers: PublicOffer[]): string[] {
  const out: string[] = [];
  const service = offers.find((offer) => offer.kind === "service" && offer.unitAmountMinor !== null);
  if (service) out.push(`Can you do a ${service.title.toLowerCase()} this week?`);
  // A budget question reads naturally for any product name, singular or plural.
  const prices = offers
    .filter((offer) => offer.kind === "goods" && offer.available !== 0 && offer.unitAmountMinor !== null)
    .map((offer) => ({ amount: offer.unitAmountMinor!, currency: offer.currency }));
  if (prices.length > 0) {
    const cheapest = prices.reduce((low, next) => (next.amount < low.amount ? next : low));
    const ceiling = Math.ceil((cheapest.amount + 1) / 2500) * 2500;
    out.push(`Anything under ${formatQuoteAmount(ceiling, cheapest.currency).replace(/\.00$/, "")}?`);
  }
  if (offers.some((offer) => offer.kind === "service" && offer.unitAmountMinor === null))
    out.push("Can you quote a job for me?");
  else if (offers.some((offer) => offer.kind === "digital")) out.push("Something I can download today");
  return out.slice(0, 3);
}

/**
 * The shop's products as cards. A priced product adds straight to the quote, so a buyer who already
 * knows what they want reaches PayPal without waiting on the assistant; asking stays one tap away.
 * A product without a price needs the shop to scope the work, so it only asks.
 */
function Mosaic({
  offers,
  onAdd,
  onAsk,
  inQuote,
  busy,
}: {
  offers: PublicOffer[];
  onAdd: (offer: PublicOffer) => void;
  onAsk: ((offer: PublicOffer) => void) | null;
  inQuote: (offerId: string) => boolean;
  busy: boolean;
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="From the shop"
    >
      {offers.slice(0, 6).map((offer, index) => {
        const price = formatQuoteAmount(offer.unitAmountMinor, offer.currency);
        const added = inQuote(offer.id);
        const priced = offer.unitAmountMinor !== null;
        const soldOut = offer.available === 0;
        return (
          <li key={offer.id} className="min-w-0">
            <Card
              title={offer.title}
              className={OFFER_CARD_CLASS}
              media={<OfferMedia offer={offer} eager={index === 0} />}
              description={price}
              action={
                <>
                  {priced || !onAsk ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={soldOut && !added}
                      aria-disabled={added || busy || undefined}
                      onClick={added || busy || soldOut ? undefined : () => onAdd(offer)}
                      aria-label={added ? `${offer.title} is in your quote` : soldOut ? `${offer.title} is sold out` : `Add ${offer.title} to your quote, ${price}`}
                    >
                      {added ? <Check aria-hidden size={16} /> : soldOut ? null : <Plus aria-hidden size={16} />}
                      {added ? "In your quote" : soldOut ? "Sold out" : priced ? "Add to quote" : "Request a quote"}
                    </Button>
                  ) : null}
                  {onAsk ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={priced ? "ghost" : "secondary"}
                      onClick={() => onAsk(offer)}
                      aria-label={`Ask about ${offer.title}`}
                    >
                      {priced ? "Ask" : "Request a quote"}
                    </Button>
                  ) : null}
                </>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/** First view: one question, the ask box, and the shop's photos. */
export function ShopWindow({
  shopName,
  demoIntro,
  offers,
  composer,
  assistantOn,
  onSuggestion,
  onAdd,
  onAsk,
  inQuote,
  busy,
}: {
  shopName: string;
  /** On a public demo, one plain paragraph saying what this shop is and that payments are sandbox. */
  demoIntro?: string;
  offers: PublicOffer[];
  composer: ReactNode;
  assistantOn: boolean;
  onSuggestion: (text: string) => void;
  onAdd: (offer: PublicOffer) => void;
  onAsk: (offer: PublicOffer) => void;
  inQuote: (offerId: string) => boolean;
  busy: boolean;
}) {
  const suggestions = assistantOn ? suggestionsFor(offers) : [];
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex min-w-0 flex-col">
        {demoIntro ? <DemoGuide shopName={shopName} /> : null}
        <h1 className="text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[46px]">
          {assistantOn ? "What are you looking for?" : `Browse ${shopName}`}
        </h1>
        <p className="text-ink-2 mt-4 max-w-[58ch] text-[17px] leading-relaxed">
          {demoIntro
            ? demoIntro
            : (assistantOn
              ? `Ask in your own words. ${shopName} answers from its published offers and shop information.`
              : "Add what you need, then pay with PayPal.")}
        </p>
        {assistantOn ? (
          <>
            <div className="mt-8">{composer}</div>
            {suggestions.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Try asking">
                {suggestions.map((text) => (
                  <li key={text}>
                    <button
                      type="button"
                      className="shop-suggestion"
                      onClick={() => onSuggestion(text)}
                    >
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
      <Mosaic
        offers={offers}
        onAdd={onAdd}
        onAsk={assistantOn ? onAsk : null}
        inQuote={inQuote}
        busy={busy}
      />
    </main>
  );
}

/**
 * On a public demo: who you are here, what to try in order, and the way to the owner's side.
 * A first-time visitor should know within one glance that this is a pretend shop and they are the customer.
 */
function DemoGuide({ shopName }: { shopName: string }) {
  const steps = [
    ["Ask", "Type what a customer would: a repair, a part, a deadline, a budget."],
    ["Get a quote", "Prices come from the shop\u2019s catalog. A custom job goes to the owner first."],
    ["Pay with PayPal", "Use a PayPal sandbox buyer account. No real money moves."],
  ] as const;
  return (
    <section aria-label="About this demo shop" className="demo-guide mb-8">
      <p className="demo-guide-kicker">Demo shop</p>
      <p className="demo-guide-lede">
        You are a customer at <strong>{shopName}</strong>, a made-up bike repair shop running Seller Desk.
      </p>
      <ol className="demo-guide-steps">
        {steps.map(([title, body], index) => (
          <li key={title}>
            <span className="demo-guide-number" aria-hidden>{index + 1}</span>
            <span>
              <strong>{title}.</strong> {body}
            </span>
          </li>
        ))}
      </ol>
      <form method="post" action="/owner/demo" className="mt-4">
        <button type="submit" className="demo-guide-link">Then see the same sale from the owner&rsquo;s desk &rarr;</button>
      </form>
    </section>
  );
}
