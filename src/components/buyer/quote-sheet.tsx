"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BottomSheet } from "@/components/arc/bottom-sheet/bottom-sheet";
import { Button } from "@/components/arc/button/button";
import { cx } from "@/lib/cx";
import { formatQuoteAmount } from "@/lib/money";
import type { BuyerQuoteView } from "@/server/domain/quotes";

/** Phone quote entry uses the library action, with the server's current total. */
export function QuoteBar({
  quote,
  onOpen,
  className,
}: {
  quote: BuyerQuoteView;
  onOpen: () => void;
  className?: string;
}) {
  const items = quote.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <div className={cx("w-full", className)}>
      <Button
        type="button"
        variant="secondary"
        onClick={onOpen}
        className="w-full"
        aria-haspopup="dialog"
      >
        {quote.order ? `Order #${quote.order.number}` : "Your quote"} · {items}{" "}
        {items === 1 ? "item" : "items"} ·{" "}
        {formatQuoteAmount(quote.totalMinor, quote.currency)}{" "}
        <ChevronUp aria-hidden size={16} />
      </Button>
    </div>
  );
}

/** Arc owns the modal, gestures and focus boundary; the portal inherits the buyer's saved palette. */
export function QuoteSheet({
  open,
  onClose,
  children,
  label = "Your quote",
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  /** Where focus goes on close instead of the button that opened the sheet. */
  returnFocus?: () => HTMLElement | null;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(anchor.current?.closest<HTMLElement>(".buyer-page") ?? null);
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title={label}
        closeLabel={`Close ${label.toLowerCase()}`}
        detents={[0.88]}
        portalContainer={container}
        returnFocus={returnFocus}
      >
        {children}
      </BottomSheet>
    </>
  );
}
