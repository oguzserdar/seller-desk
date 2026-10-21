"use client";

/**
 * The buyer's shop: it opens on the shop's photos and an ask box, and becomes a
 * conversation beside the quote once the buyer asks. Prices, stock and the
 * quote always come from the server; the assistant only proposes.
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ShopConversation } from "@/components/assistant/conversation";
import { Button } from "@/components/arc/button/button";
import { Alert } from "@/components/arc/alert/alert";
import {
  api,
  clearToken,
  readToken,
  useBuyerSession,
} from "@/lib/buyer-client";
import type { PublicOffer } from "@/server/domain/offers";
import type { BuyerQuoteView } from "@/server/domain/quotes";
import { Composer } from "./composer";
import { OfferPhoto, OfferTile } from "./offer-tile";
import { formatQuoteAmount } from "@/lib/money";
import { QuoteBar, QuoteSheet } from "./quote-sheet";
import { PurchaseLadder } from "./purchase-ladder";
import { QuoteSummary } from "./quote-summary";
import { purchaseSteps } from "@/lib/purchase-steps";
import { ShopWindow } from "./shop-window";
import { Thread } from "./thread";
import { useBuyerQuote } from "./use-buyer-quote";
import {
  useConversationSync,
  type BuyerHistory as History,
} from "./use-conversation-sync";
import { SellerReply } from "./seller-reply";
import { ReplyRecovery } from "./reply-recovery";

type CatalogData = { offers: PublicOffer[] };

function chatErrorText(
  error: Error | undefined,
): { text: string; expired: boolean } | null {
  if (!error) return null;
  try {
    const body = JSON.parse(error.message) as {
      state?: string;
      message?: string;
    };
    return {
      text: body.message ?? "The assistant could not answer just now.",
      expired: body.state === "unauthorized",
    };
  } catch {
    return {
      text: "The assistant could not finish. Check your current quote before trying again.",
      expired: false,
    };
  }
}

/** Connects the shop conversation, server quote and buyer session. */
export function ShopAssistant({
  entry,
  shopName,
}: {
  entry: "page" | "widget";
  shopName: string;
}) {
  const widget = entry === "widget";
  const { state: session, restart } = useBuyerSession(entry);
  const [offers, setOffers] = useState<PublicOffer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<"loading" | "on" | "off">(
    "loading",
  );
  const [handoff, setHandoff] = useState<History["handoff"]>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [framed, setFramed] = useState(false);
  const seenQuoteCall = useRef<string | null>(null);

  const quote = useBuyerQuote({ widget, onSessionLost: restart });
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/buyer/chat",
        headers: (): Record<string, string> => {
          const token = readToken()?.token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages.at(-1) },
        }),
      }),
    [],
  );
  const chat = useChat({ transport });
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    clearError,
  } = chat;
  const {
    control,
    replyState,
    restore: restoreControl,
  } = useConversationSync({
    ready: session.status === "ready",
    messages,
    status,
    stop,
    clearError,
    setMessages,
    setHandoff,
  });
  const withSeller = control?.handler === "seller";
  const canChat = assistant === "on" || withSeller;

  const load = useCallback(async () => {
    setLoadError(null);
    const [catalog, history, currentQuote] = await Promise.all([
      api<CatalogData>("/api/buyer/catalog"),
      api<History>("/api/buyer/chat"),
      api<BuyerQuoteView>("/api/buyer/quote"),
    ]);
    if (
      catalog.httpStatus === 401 ||
      history.httpStatus === 401 ||
      currentQuote.httpStatus === 401
    ) {
      await restart();
      return;
    }
    if (!catalog.data) {
      setLoadError(catalog.message);
      return;
    }
    if (currentQuote.httpStatus !== 200) {
      setLoadError(currentQuote.message);
      return;
    }
    // Historical tool output must not replace a newer manually edited or cancelled quote.
    seenQuoteCall.current =
      history.data?.messages
        .flatMap((message) => message.parts)
        .filter(isToolUIPart)
        .findLast(
          (part) =>
            part.type === "tool-propose_quote" &&
            part.state === "output-available",
        )?.toolCallId ?? null;
    quote.restoreQuote(currentQuote.data);
    setOffers(catalog.data.offers);
    setMessages(history.data?.messages ?? []);
    setAssistant(history.data?.assistant ? "on" : "off");
    setHandoff(history.data?.handoff ?? null);
    restoreControl(
      history.data?.control ?? null,
      history.data?.messages ?? [],
      history.data?.replyState,
    );
  }, [restart, setMessages, quote.restoreQuote, restoreControl]);

  useEffect(() => {
    if (session.status === "ready") void load();
  }, [session.status, load]);

  const busy = status === "submitted" || status === "streaming";

  // When the assistant changes the quote, show the quote the server saved.
  useEffect(() => {
    for (const message of [...messages].reverse()) {
      for (const part of [...message.parts].reverse()) {
        if (
          isToolUIPart(part) &&
          part.type === "tool-propose_quote" &&
          part.state === "output-available"
        ) {
          const output = part.output as { quoteId?: string };
          if (output.quoteId && part.toolCallId !== seenQuoteCall.current) {
            seenQuoteCall.current = part.toolCallId;
            void quote.loadQuote(output.quoteId);
          }
          return;
        }
      }
    }
  }, [messages, quote.loadQuote]);

  // Inside a merchant's site: Escape or the close button asks the launcher (our widget.js) to close the panel.
  useEffect(() => {
    setFramed(widget && window.parent !== window);
  }, [widget]);
  const closeWidget = useCallback(() => {
    const parentOrigin =
      window.location.ancestorOrigins?.[0] ??
      (document.referrer ? new URL(document.referrer).origin : "*");
    window.parent.postMessage({ type: "seller-desk:close" }, parentOrigin);
  }, []);
  useEffect(() => {
    if (!framed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        closeWidget();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [framed, closeWidget]);

  const chatError = chatErrorText(chat.error);
  useEffect(() => {
    if (chatError?.expired) {
      clearToken();
      setMessages([]);
      quote.reset();
      void restart();
    }
  }, [chatError?.expired, quote.reset, restart, setMessages]);

  const ask = (text: string) => {
    clearError();
    void sendMessage({ text });
  };

  const endChat = async () => {
    stop();
    await api("/api/buyer/session/end", { method: "POST", json: {} });
    clearToken();
    setMessages([]);
    setHandoff(null);
    restoreControl(null);
    quote.reset();
    seenQuoteCall.current = null;
    await restart();
  };

  const byId = useMemo(
    () => new Map((offers ?? []).map((offer) => [offer.id, offer])),
    [offers],
  );
  const inQuote = (offerId: string) =>
    Boolean(
      quote.quote?.isLatest &&
        quote.quote.lines.some((line) => line.offerId === offerId),
    );
  const imageFor = (offerId: string) => byId.get(offerId)?.imagePath ?? null;
  // Quotes do not hold stock, so the live availability is the ceiling (an unpublished offer cannot grow).
  const limitFor = (offerId: string) => {
    const offer = byId.get(offerId);
    return offer
      ? Math.min(offer.maxQuantity, offer.available ?? offer.maxQuantity)
      : (quote.quote?.lines.find((l) => l.offerId === offerId)?.quantity ?? 1);
  };
  const streaming = status === "submitted" || status === "streaming";

  if (session.status === "error" || loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert tone="danger" title="The shop could not open">
          {session.status === "error" ? session.message : loadError}
        </Alert>
        <Button
          className="mt-4"
          onClick={() =>
            session.status === "error" ? void restart() : void load()
          }
        >
          Try again
        </Button>
      </div>
    );
  }

  // Requested, priced, paid and what the shop owes next, read from the quote's own records.
  const standing = quote.quote ? (
    // Rendered in both the desktop panel and the phone sheet, so it is named by aria-label, not by an id.
    <section aria-label="Where it stands" className="pt-1">
      <h2 className="text-ink-3 text-[13px] font-medium">Where it stands</h2>
      <PurchaseLadder steps={purchaseSteps(quote.quote)} className="mt-1" />
    </section>
  ) : null;
  const summary = (titled: boolean) => (
    <QuoteSummary
      titled={titled}
      quote={quote.quote}
      imageFor={imageFor}
      limitFor={limitFor}
      busy={quote.busy}
      error={quote.error}
      payLabel={widget ? "Review and pay in a new tab" : "Pay with PayPal"}
      payReady={quote.payReady}
      onQuantity={quote.setQuantity}
      onPay={() => void quote.pay()}
      onReviewPayment={quote.openReview}
      onFix={quote.fix}
      onStartOver={quote.startOver}
      standing={standing}
    />
  );
  const composer = (large: boolean) => (
    <>
      <Composer
        shopName={shopName}
        onSend={ask}
        onStop={stop}
        streaming={streaming}
        disabled={!canChat || (!streaming && replyState === "answering")}
        placeholder={
          withSeller
            ? "Write to the shop owner"
            : large
              ? "Describe what you need"
              : "Ask a follow-up, or add something"
        }
      />
    </>
  );
  const conversation = messages.length > 0;
  const browsing =
    assistant === "off" && (quote.quote !== null || (offers?.length ?? 0) > 6);

  return (
    <div
      className={`shop-shell flex min-h-0 flex-col ${conversation || browsing ? "shop-active" : ""}`}
    >
      <header className="shop-header">
        <div className="min-w-0">
          <p className="shop-wordmark">{shopName}</p>
          <p className="shop-tagline mt-1 text-[14px]">
            {withSeller ? "With the shop owner" : "Shop assistant"}
          </p>
        </div>
        <div className="flex items-center gap-5 text-[14px] font-medium">
          {widget ? (
            <a
              href="/buy"
              target="_blank"
              rel="noopener"
              className="text-ink-2 hover:text-ink"
            >
              Open full page
            </a>
          ) : null}
          {conversation || quote.quote ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void endChat()}
            >
              End chat
            </Button>
          ) : null}
          {framed ? (
            <Button
              type="button"
              variant="ghost"
              onClick={closeWidget}
              aria-label="Close the shop assistant"
            >
              <X aria-hidden size={18} />
            </Button>
          ) : null}
        </div>
      </header>

      {session.status === "ready" && session.mode === "memory" ? (
        <Alert
          tone="warning"
          className="mx-4 mb-2"
          title="This chat lasts until you reload."
        >
          This browser blocks storage for embedded shops.{" "}
          <a
            href="/buy"
            target="_blank"
            rel="noopener"
            className="font-semibold underline"
          >
            Open the full page
          </a>{" "}
          to keep it.
        </Alert>
      ) : null}

      {offers === null || assistant === "loading" ? (
        <div
          role="status"
          className="mx-auto grid w-full max-w-[1200px] gap-10 px-4 pt-6 sm:px-6 lg:grid-cols-[5fr_6fr] lg:pt-12"
          aria-label="Opening the shop"
        >
          <div className="flex flex-col gap-4">
            <div className="bg-sunken h-11 w-4/5 animate-pulse rounded-[10px]" />
            <div className="bg-sunken h-5 w-3/5 rounded" />
            <div className="bg-sunken mt-6 h-16 rounded-[14px]" />
          </div>
          <div className="bg-sunken aspect-[4/3] animate-pulse rounded-[12px]" />
        </div>
      ) : conversation || browsing ? (
        <div className="shop-workspace">
          <main className="flex min-h-0 min-w-0 flex-col">
            <h1 className="sr-only">Shopping with {shopName}</h1>
            <ShopConversation shopName={shopName}>
              {withSeller ? (
                <p role="status" className="mb-5 text-[14px] text-ink-2">
                  The shop owner is handling this conversation. Your messages go
                  to them.
                </p>
              ) : null}
              {!withSeller && handoff && handoff.state !== "resumed" ? (
                <SellerReply
                  handoff={handoff}
                  shopName={shopName}
                  canContinue={assistant === "on" && !busy}
                  onContinue={() =>
                    ask(
                      `Please continue using the seller's answer to my question: ${handoff.question}`,
                    )
                  }
                />
              ) : null}
              {conversation ? (
                <Thread
                  widget={widget}
                  messages={messages}
                  status={status}
                  waitingOnShop={!withSeller && handoff?.state === "open"}
                  shopName={shopName}
                  inQuote={inQuote}
                  quoteBusy={quote.busy !== null}
                  onAdd={quote.addOffer}
                  onViewQuote={() => setSheetOpen(true)}
                  error={
                    chatError && !chatError.expired ? chatError.text : null
                  }
                  onRetry={() => {
                    clearError();
                    void regenerate();
                  }}
                />
              ) : (
                <ul
                  aria-label={`What ${shopName} offers`}
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                >
                  {offers.map((offer) => (
                    <OfferTile
                      key={offer.id}
                      offer={offer}
                      inQuote={inQuote(offer.id)}
                      busy={quote.busy !== null}
                      onAdd={() => quote.addOffer(offer.id)}
                    />
                  ))}
                </ul>
              )}
              {!busy &&
              !chatError &&
              !withSeller &&
              assistant === "on" &&
              (!handoff || handoff.state === "resumed") ? (
                <ReplyRecovery
                  state={replyState}
                  onContinue={() => {
                    clearError();
                    void regenerate();
                  }}
                />
              ) : null}
            </ShopConversation>
            <div className="shop-composer-dock">
              {quote.quote ? (
                <QuoteBar
                  quote={quote.quote}
                  onOpen={() => setSheetOpen(true)}
                  className="lg:hidden"
                />
              ) : null}
              {conversation ? composer(false) : null}
              {conversation ? (
                <p className="text-ink-3 px-1 text-[12px]">
                  {withSeller
                    ? "Your reply goes directly to the shop owner."
                    : "AI assistant · Review your quote before paying."}
                </p>
              ) : null}
            </div>
          </main>
          <aside className="shop-quote-rail">
            {summary(true)}
            {assistant === "on" && offers.length > 0 ? (
              <section
                className="border-line mt-6 border-t pt-5"
                aria-label="Ask about"
              >
                <h2 className="text-[15px] font-semibold">Ask about</h2>
                <ul className="mt-2 flex flex-col">
                  {offers.slice(0, 4).map((offer) => (
                    <li key={offer.id}>
                      <button
                        type="button"
                        aria-disabled={streaming || undefined}
                        onClick={streaming ? undefined : () => ask(`Tell me about the ${offer.title}`)}
                        className="shop-ask-row"
                      >
                        <OfferPhoto
                          offer={offer}
                          sizes="40px"
                          className="size-10 shrink-0 rounded-[8px]"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {offer.title}
                        </span>
                        <span className="tabular text-ink-2 shrink-0">
                          {offer.unitAmountMinor === null
                            ? "Quote"
                            : formatQuoteAmount(
                                offer.unitAmountMinor,
                                offer.currency,
                              )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
          <QuoteSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            label={quote.quote?.order ? `Order #${quote.quote.order.number}` : "Your quote"}
          >
            {summary(false)}
          </QuoteSheet>
        </div>
      ) : (
        <ShopWindow
          shopName={shopName}
          offers={offers}
          assistantOn={assistant === "on"}
          composer={composer(true)}
          onSuggestion={ask}
          onPick={(offer) =>
            assistant === "on"
              ? ask(`Tell me about the ${offer.title}`)
              : quote.addOffer(offer.id)
          }
        />
      )}
    </div>
  );
}
