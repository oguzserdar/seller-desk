"use client";

import { Card } from "@/components/arc/card/card";
import { Button } from "@/components/arc/button/button";
import { Check, Download, Package, Plus, Wrench } from "lucide-react";
import Image from "next/image";
import { cx } from "@/lib/cx";
import { formatQuoteAmount } from "@/lib/money";
import type { OfferKind } from "@/server/db/types";
import { availabilityText } from "./labels";

/** Public product facts shown in a buyer offer. */
export type TileOffer = {
  id: string;
  kind: OfferKind;
  title: string;
  unitAmountMinor: number | null;
  currency: string;
  available: number | null;
  maxQuantity: number;
  requiresScopeReview: boolean;
  imagePath: string | null;
};

/** What happens after payment, in a few words. */
export function fulfilmentText(
  offer: Pick<TileOffer, "kind" | "unitAmountMinor">,
): string {
  if (offer.kind === "digital") return "Download after payment";
  if (offer.kind === "service")
    return offer.unitAmountMinor === null
      ? "Shop quotes the work first"
      : "Shop books a time after payment";
  return "Pickup at the shop";
}

/** Loads only the shop-provided image path. Every use shows the title beside the photo, so the photo itself is decorative (empty alt) and screen readers hear the name once. */
export function OfferPhoto({
  offer,
  sizes,
  className,
  eager = false,
}: {
  offer: Pick<TileOffer, "title" | "imagePath">;
  sizes: string;
  className?: string;
  /** The page's largest above-the-fold image: load it first (Next 16 docs prefer this to preload). */ eager?: boolean;
}) {
  return (
    <div className={cx("bg-photo relative overflow-hidden", className)}>
      {offer.imagePath ? (
        <Image
          src={offer.imagePath}
          alt=""
          fill
          sizes={sizes}
          {...(eager
            ? { loading: "eager" as const, fetchPriority: "high" as const }
            : {})}
          className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      ) : null}
    </div>
  );
}

const KIND_ICON = { goods: Package, service: Wrench, digital: Download } as const;

/** Card class that hides the stand-in panel's wrapper on a phone. */
export const OFFER_CARD_CLASS = "h-full max-sm:[&>div:has([data-no-photo])]:hidden";

/**
 * The top of a product card. Without a photo, wide screens get a quiet panel with the kind's icon,
 * so every card in a row is the same height. A phone shows no panel: it would be a screen-tall
 * empty square.
 */
export function OfferMedia({
  offer,
  eager = false,
}: {
  offer: Pick<TileOffer, "title" | "imagePath" | "kind">;
  eager?: boolean;
}) {
  if (offer.imagePath)
    return (
      <OfferPhoto
        offer={offer}
        eager={eager}
        sizes="(min-width: 640px) 300px, 90vw"
        className="aspect-square w-full"
      />
    );
  return <OfferIcon kind={offer.kind} data-no-photo className="aspect-square w-full" size={44} />;
}

/** A product's kind as an icon on the photo tint, for a product without a photo. */
export function OfferIcon({
  kind,
  size,
  className,
  ...props
}: {
  kind: OfferKind;
  size: number;
  className?: string;
  "data-no-photo"?: boolean;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <div {...props} className={cx("bg-photo text-ink-3 grid place-items-center", className)}>
      <Icon aria-hidden size={size} strokeWidth={1.25} />
    </div>
  );
}

/** One offer the assistant found: photo, price, what happens next, and a way to add it. */
export function OfferTile({
  offer,
  inQuote,
  busy,
  onAdd,
}: {
  offer: TileOffer;
  inQuote: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const stock = availabilityText(offer);
  const soldOut = stock?.soldOut ?? false;
  return (
    <li className="min-w-0">
      <Card
        title={offer.title}
        description={
          stock
            ? `${stock.text}. ${fulfilmentText(offer)}`
            : fulfilmentText(offer)
        }
        className={OFFER_CARD_CLASS}
        media={<OfferMedia offer={offer} />}
        action={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onAdd}
            disabled={soldOut || busy || inQuote}
          >
            {inQuote ? (
              <Check aria-hidden size={16} />
            ) : soldOut ? null : (
              <Plus aria-hidden size={16} />
            )}
            {inQuote
              ? "In your quote"
              : soldOut
                ? "Sold out"
                : offer.unitAmountMinor === null
                  ? "Request a quote"
                  : "Add to quote"}
          </Button>
        }
      >
        <p className="mt-3 tabular">
          {offer.unitAmountMinor === null
            ? "Price after review"
            : formatQuoteAmount(offer.unitAmountMinor, offer.currency)}
        </p>
      </Card>
    </li>
  );
}

/**
 * A compact offer inside a chat reply: small photo, two-line title, price, one
 * button. Replies show these in a sideways row, as shop assistants commonly do,
 * so a suggestion never pushes the answer off screen. The button keeps focus
 * once the offer is in the quote (aria-disabled, not disabled), so keyboard and
 * screen-reader users stay where they were.
 */
export function OfferCard({
  offer,
  inQuote,
  busy,
  onAdd,
}: {
  offer: TileOffer;
  inQuote: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const stock = availabilityText(offer);
  const soldOut = stock?.soldOut ?? false;
  const blocked = soldOut || busy || inQuote;
  return (
    <li className="offer-card">
      <OfferPhoto offer={offer} sizes="176px" className="aspect-[4/3] w-full rounded-[10px]" />
      <h3 className="mt-2 line-clamp-2 text-[14px] leading-snug font-semibold">{offer.title}</h3>
      <p className="text-ink-3 mt-0.5 line-clamp-2 min-h-[2lh] text-[12px] leading-snug">
        {stock ? `${stock.text}. ${fulfilmentText(offer)}` : fulfilmentText(offer)}
      </p>
      <p className="tabular mt-1 mb-2 text-[14px]">
        {offer.unitAmountMinor === null ? "Price after review" : formatQuoteAmount(offer.unitAmountMinor, offer.currency)}
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-auto w-full"
        aria-disabled={blocked || undefined}
        onClick={blocked ? undefined : onAdd}
      >
        {inQuote ? <Check aria-hidden size={15} /> : soldOut ? null : <Plus aria-hidden size={15} />}
        {inQuote ? "In your quote" : soldOut ? "Sold out" : offer.unitAmountMinor === null ? "Request a quote" : "Add"}
      </Button>
    </li>
  );
}
