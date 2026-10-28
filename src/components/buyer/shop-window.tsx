"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/arc/card/card";
import { Button } from "@/components/arc/button/button";
import { Check, Plus } from "lucide-react";
import { formatQuoteAmount } from "@/lib/money";
import type { PublicOffer } from "@/server/domain/offers";
import { OfferPhoto } from "./offer-tile";

/** Starter questions drawn from what this shop actually sells. */
export function suggestionsFor(offers: PublicOffer[]): string[] {
  const out: string[] = [];
  const goods = offers.filter(
    (offer) => offer.kind === "goods" && offer.available !== 0,
  );
  if (goods.length > 0) {
    const ceiling =
      Math.ceil(
        Math.max(...goods.map((offer) => offer.unitAmountMinor ?? 0)) / 2500,
      ) * 2500;
    out.push(
      `A gift under ${formatQuoteAmount(ceiling, goods[0]!.currency).replace(/\.00$/, "")}`,
    );
  }
  const service = offers.find((offer) => offer.kind === "service");
  if (service) out.push(`I need a ${service.title.toLowerCase()}`);
  if (offers.some((offer) => offer.kind === "digital"))
    out.push("Something I can download today");
  return out;
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
              media={
                // A missing photo would leave a screen-tall empty square on a phone.
                offer.imagePath ? (
                  <OfferPhoto
                    offer={offer}
                    eager={index === 0}
                    sizes="(min-width: 640px) 300px, 90vw"
                    className="aspect-square w-full"
                  />
                ) : undefined
              }
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
        <h1 className="text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[46px]">
          {assistantOn ? "What are you looking for?" : `Browse ${shopName}`}
        </h1>
        <p className="text-ink-2 mt-4 max-w-[44ch] text-[17px] leading-relaxed">
          {assistantOn
            ? `Ask in your own words. ${shopName} answers from its published offers and shop information.`
            : "Add what you need, then pay with PayPal."}
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
