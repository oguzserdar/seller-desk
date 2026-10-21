"use client";

/**
 * The buyer's quote on the client. The server owns every price: this hook only
 * sends offer ids and quantities, then shows the quote the server returns.
 * The assistant and the manual buttons change the same quote thread.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/buyer-client";
import type { BuyerQuoteView } from "@/server/domain/quotes";
import type { PaymentView } from "@/server/payments/engine";

/** A buyer's explicit change to the quote requirements. */
export type QuoteFix = { kind: "pickup" } | { kind: "raise_budget"; budgetMinor: number } | { kind: "details"; buyerNote: string };
/** The quote operation currently in progress. */
export type QuoteBusy = "quote" | "pay" | null;

const OPEN = new Set(["review_ready", "needs_information", "seller_review"]);
const HANDOFF_REFRESH_MS = 90_000;
const QUOTE_REFRESH_MS = 6_000;

/** Whether the buyer can still change this quote. */
export function isOpenQuote(quote: BuyerQuoteView | null): quote is BuyerQuoteView {
  return Boolean(quote && quote.isLatest && OPEN.has(quote.status));
}

async function readLatestQuote(quoteId: string) {
  const result = await api<BuyerQuoteView>(`/api/buyer/quote/${quoteId}`);
  if (result.data && !result.data.isLatest) return api<BuyerQuoteView>(`/api/buyer/quote/${result.data.latestQuoteId}`);
  return result;
}

/** Keeps the reviewed quote current across AI edits, manual changes and checkout in another tab. */
export function useBuyerQuote({ widget, onSessionLost }: { widget: boolean; onSessionLost: () => Promise<void> }) {
  const router = useRouter();
  const [quote, setQuote] = useState<BuyerQuoteView | null>(null);
  const [busy, setBusy] = useState<QuoteBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoffHref, setHandoffHref] = useState<string | null>(null);
  const [handoffUse, setHandoffUse] = useState(0);
  const changeVersion = useRef(0);
  const pendingQuoteRequest = useRef<number | null>(null);

  const restoreQuote = useCallback((next: BuyerQuoteView | null) => {
    changeVersion.current += 1;
    setQuote(next);
  }, []);

  const loadQuote = useCallback(async (quoteId: string) => {
    const version = ++changeVersion.current;
    const result = await readLatestQuote(quoteId);
    if (result.data && changeVersion.current === version) setQuote(result.data);
  }, []);

  // Checkout and seller review can finish elsewhere. Read only while visible,
  // and ignore any response overtaken by a manual edit, AI quote or session reset.
  const quoteId = quote?.id;
  const quoteStatus = quote?.status;
  useEffect(() => {
    if (!quoteId || busy) return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      const version = changeVersion.current;
      const result = await readLatestQuote(quoteId);
      inFlight = false;
      if (cancelled || version !== changeVersion.current || !result.data) return;
      setQuote(result.data);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const pending = quoteStatus && [...OPEN, "accepted"].includes(quoteStatus);
    const timer = pending ? window.setInterval(refresh, QUOTE_REFRESH_MS) : null;
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [quoteId, quoteStatus, busy]);

  const send = useCallback(
    async (lines: { offerId: string; quantity: number }[], overrides: { budgetMinor?: number | null; deliveryRequested?: boolean; buyerNote?: string } = {}) => {
      const version = ++changeVersion.current;
      setBusy("quote");
      setError(null);
      pendingQuoteRequest.current = version;
      try {
        if (lines.length === 0) {
          if (quote && isOpenQuote(quote)) {
            const cancelled = await api(`/api/buyer/quote/${quote.id}/cancel`, { method: "POST", json: { revision: quote.revision } });
            if (version !== changeVersion.current) return;
            if (!cancelled.data) {
              setError(cancelled.message);
              void loadQuote(quote.id);
              return;
            }
          }
          setQuote(null);
          return;
        }
        const reusable = quote && quote.isLatest && !["accepted", "consumed"].includes(quote.status);
        const result = await api<BuyerQuoteView>("/api/buyer/quote", {
          method: "POST",
          json: {
            ...(reusable ? { threadId: quote.threadId } : {}),
            lines,
            buyerNote: overrides.buyerNote ?? quote?.buyerNote ?? undefined,
            budgetMinor: overrides.budgetMinor !== undefined ? overrides.budgetMinor : (quote?.budgetMinor ?? null),
            deliveryRequested: overrides.deliveryRequested ?? quote?.deliveryRequested ?? false,
          },
        });
        if (version !== changeVersion.current) return;
        if (result.httpStatus === 401) {
          setQuote(null);
          setError("Your chat session ended, so a new one started. Add your items again.");
          await onSessionLost();
          return;
        }
        if (!result.data) {
          setError(result.message);
          return;
        }
        setQuote(result.data);
      } finally {
        if (pendingQuoteRequest.current === version) {
          pendingQuoteRequest.current = null;
          setBusy(null);
        }
      }
    },
    [onSessionLost, quote, loadQuote],
  );

  // An expired quote's lines are reused so any change prices them again.
  const currentLines = useCallback(() => {
    const usable = quote !== null && quote.isLatest && (OPEN.has(quote.status) || quote.status === "expired");
    return usable ? quote.lines.map((line) => ({ offerId: line.offerId, quantity: line.quantity })) : [];
  }, [quote]);

  const setQuantity = useCallback(
    (offerId: string, quantity: number) => {
      const lines = currentLines().filter((line) => line.offerId !== offerId);
      const at = currentLines().findIndex((line) => line.offerId === offerId);
      if (quantity > 0) lines.splice(at === -1 ? lines.length : at, 0, { offerId, quantity });
      void send(lines);
    },
    [currentLines, send],
  );

  const addOffer = useCallback(
    (offerId: string) => {
      const existing = currentLines().find((line) => line.offerId === offerId);
      setQuantity(offerId, (existing?.quantity ?? 0) + 1);
    },
    [currentLines, setQuantity],
  );

  const fix = useCallback(
    (next: QuoteFix) => void send(currentLines(), next.kind === "pickup" ? { deliveryRequested: false } : next.kind === "details" ? { buyerNote: next.buyerNote } : { budgetMinor: next.budgetMinor }),
    [currentLines, send],
  );

  // In the widget, PayPal opens in a new tab: keep a fresh one-time handoff link ready so the tab opens on the click itself.
  useEffect(() => {
    setHandoffHref(null);
    if (!widget || !quoteId) return;
    let cancelled = false;
    const refresh = async () => {
      const result = await api<{ code: string }>("/api/buyer/handoff", { method: "POST", json: { quoteId } });
      if (!cancelled && result.data) setHandoffHref(`/quote/${quoteId}#handoff=${encodeURIComponent(result.data.code)}`);
    };
    void refresh();
    const timer = window.setInterval(refresh, HANDOFF_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [widget, quoteId, handoffUse]);

  const openReview = useCallback(() => {
    if (!quote) return;
    if (!widget) {
      router.push(quote.order ? `/order/${quote.order.id}` : `/quote/${quote.id}`);
      return;
    }
    if (!handoffHref) return;
    window.open(handoffHref, "_blank", "noopener");
    setHandoffHref(null);
    setHandoffUse((count) => count + 1);
  }, [handoffHref, quote, router, widget]);

  const pay = useCallback(async () => {
    if (!quote) return;
    if (widget) {
      openReview();
      return;
    }
    setBusy("pay");
    setError(null);
    const result = await api<PaymentView>("/api/buyer/checkout", { method: "POST", json: { quoteId: quote.id, revision: quote.revision } });
    if (!result.data) {
      setBusy(null);
      setError(result.message);
      if (result.httpStatus === 409) void loadQuote(quote.id);
      return;
    }
    if (result.data.state === "order_created" && result.data.approvalUrl) {
      window.location.assign(result.data.approvalUrl);
      return;
    }
    router.push(`/quote/${quote.id}`);
  }, [openReview, loadQuote, quote, router, widget]);

  // Emptying is reversible: the cleared lines and note are kept briefly so Undo can send them again.
  const [cleared, setCleared] = useState<{ lines: { offerId: string; quantity: number }[]; buyerNote?: string } | null>(null);
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setCleared(null), 10_000);
    return () => clearTimeout(timer);
  }, [cleared]);
  const startOver = useCallback(() => {
    const lines = currentLines();
    if (lines.length) setCleared({ lines, buyerNote: quote?.buyerNote ?? undefined });
    void send([]);
  }, [currentLines, quote, send]);
  const undoStartOver = useCallback(() => {
    if (!cleared) return;
    setCleared(null);
    void send(cleared.lines, cleared.buyerNote ? { buyerNote: cleared.buyerNote } : {});
  }, [cleared, send]);

  const reset = useCallback(() => {
    pendingQuoteRequest.current = null;
    restoreQuote(null);
    setError(null);
    setBusy(null);
  }, [restoreQuote]);

  return { quote, restoreQuote, busy, error, payReady: !widget || Boolean(handoffHref), loadQuote, addOffer, setQuantity, fix, pay, openReview, startOver, undoStartOver: cleared ? undoStartOver : null, reset };
}
