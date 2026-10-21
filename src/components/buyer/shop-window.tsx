"use client";

import type { ReactNode } from "react";
import { Card } from "@/components/arc/card/card";
import { Button } from "@/components/arc/button/button";
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

/** Actual library cards keep product actions explicit and keyboard accessible. */
function Mosaic({
  offers,
  onPick,
  pickLabel,
  actionLabel,
}: {
  offers: PublicOffer[];
  onPick: (offer: PublicOffer) => void;
  pickLabel: (offer: PublicOffer) => string;
  actionLabel: string;
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="From the shop"
    >
      {offers.slice(0, 6).map((offer, index) => (
        <li key={offer.id} className="min-w-0">
          <Card
            title={offer.title}
            media={
              <OfferPhoto
                offer={offer}
                eager={index === 0}
                sizes="(min-width: 640px) 300px, 90vw"
                className="aspect-square w-full"
              />
            }
            description={formatQuoteAmount(
              offer.unitAmountMinor,
              offer.currency,
            )}
            action={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onPick(offer)}
                aria-label={`${pickLabel(offer)}, ${formatQuoteAmount(offer.unitAmountMinor, offer.currency)}`}
              >
                {offer.unitAmountMinor === null
                  ? "Request a quote"
                  : actionLabel}
              </Button>
            }
          />
        </li>
      ))}
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
  onPick,
}: {
  shopName: string;
  offers: PublicOffer[];
  composer: ReactNode;
  assistantOn: boolean;
  onSuggestion: (text: string) => void;
  onPick: (offer: PublicOffer) => void;
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
        actionLabel={assistantOn ? "Ask about this" : "Add to quote"}
        offers={offers}
        onPick={onPick}
        pickLabel={(offer) =>
          assistantOn
            ? `Ask about ${offer.title}`
            : `Add ${offer.title} to your quote`
        }
      />
    </main>
  );
}
